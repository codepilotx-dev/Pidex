import { CalendarRpcMethods, type RpcMethod, type RpcParams } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'
import type { ScheduledTaskUpdate } from '../../../storage/repositories/ScheduledTaskRepository'
import { AgentError } from '../../../Domain'

type CalendarMethod = keyof typeof CalendarRpcMethods
const methods = Object.keys(CalendarRpcMethods) as CalendarMethod[]
const decode = <M extends CalendarMethod>(method: M, raw: unknown): RpcParams<M> =>
  Schema.decodeUnknownSync(CalendarRpcMethods[method].params as never)(raw) as RpcParams<M>

export const calendarHandlers = {
  name: 'calendar',
  methods,
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    if (!(method in CalendarRpcMethods)) return undefined
    const calendar = runtime.dependencies.calendar
    const scheduledTasks = runtime.dependencies.scheduledTasks
    const schedulePlans = runtime.dependencies.schedulePlans
    if (!calendar || !scheduledTasks || !schedulePlans)
      throw new AgentError('INTERNAL_ERROR', '日历服务不可用', 500)
    switch (method) {
      case 'calendar/range':
        return calendar.range(decode(method, rawParams))
      case 'scheduled-task/read':
        return { scheduledTask: scheduledTasks.read(decode(method, rawParams).id) }
      case 'scheduled-task/create':
        return { scheduledTask: await scheduledTasks.create(decode(method, rawParams)) }
      case 'scheduled-task/update': {
        const { id, ...patch } = decode(method, rawParams)
        return { scheduledTask: await scheduledTasks.update(id, patch as ScheduledTaskUpdate) }
      }
      case 'scheduled-task/delete': {
        const params = decode(method, rawParams)
        return { scheduledTask: await scheduledTasks.delete(params.id, params.expectedRevision) }
      }
      case 'scheduled-task/run': {
        const params = decode(method, rawParams)
        return { scheduledTask: await scheduledTasks.runNow(params.id, params.operationId) }
      }
      case 'schedule-plan/read':
        return { proposal: schedulePlans.read(decode(method, rawParams).id) }
      case 'schedule-plan/commit':
        return { proposal: await schedulePlans.commit(decode(method, rawParams)) }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
