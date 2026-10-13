import { ScheduleDraftRpcMethods, type RpcMethod, type RpcParams } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import type { RpcRouter } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

type ScheduleDraftMethod = keyof typeof ScheduleDraftRpcMethods
const methods = Object.keys(ScheduleDraftRpcMethods) as ScheduleDraftMethod[]
const decode = <M extends ScheduleDraftMethod>(method: M, raw: unknown): RpcParams<M> =>
  Schema.decodeUnknownSync(ScheduleDraftRpcMethods[method].params as never)(raw) as RpcParams<M>

/**
 * 任务规划草案的读取、确认、取消与反馈。确认依赖 schedule.draft.v1：能力缺失时
 * 方法本身就不可用，客户端不会退回创建普通自动化。
 */
export const scheduleDraftHandlers = {
  name: 'schedule-draft',
  methods,
  async handle(runtime: RpcRouter, method: RpcMethod, raw: unknown) {
    if (!(method in ScheduleDraftRpcMethods)) return undefined
    const service = runtime.dependencies.schedulePlans
    if (!service) throw new AgentError('INTERNAL_ERROR', '任务规划服务不可用', 500)
    switch (method as ScheduleDraftMethod) {
      case 'schedule-draft/read':
        return { draft: service.readDraft(decode('schedule-draft/read', raw).id) }
      case 'schedule-draft/commit':
        return { draft: await service.commitDraft(decode('schedule-draft/commit', raw)) }
      case 'schedule-draft/cancel': {
        const params = decode('schedule-draft/cancel', raw)
        return { draft: await service.cancelDraft(params.id, params.expectedRevision) }
      }
      case 'schedule-draft/feedback':
        return { draft: await service.feedbackDraft(decode('schedule-draft/feedback', raw)) }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
