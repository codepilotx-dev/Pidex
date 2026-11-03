import { TaskScheduleRpcMethods, type RpcMethod, type RpcParams } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import type { RpcHandlerGroup } from './Types'
import type { RpcRouter } from '../RpcRouter'
type Method = keyof typeof TaskScheduleRpcMethods
const decode = <M extends Method>(method: M, raw: unknown): RpcParams<M> =>
  Schema.decodeUnknownSync(TaskScheduleRpcMethods[method].params as never)(raw) as RpcParams<M>
export const taskScheduleHandlers = {
  name: 'task-schedule',
  methods: Object.keys(TaskScheduleRpcMethods) as Method[],
  async handle(runtime: RpcRouter, method: RpcMethod, raw: unknown) {
    if (!(method in TaskScheduleRpcMethods)) return undefined
    const service = runtime.dependencies.taskSchedules
    if (!service?.available()) throw new AgentError('PERMISSION_DENIED', '任务安排服务不可用', 403)
    switch (method) {
      case 'task-schedule/list':
        return service.list()
      case 'task-schedule/plans':
        return { plans: service.plans(decode(method, raw).threadId) }
      case 'task-schedule/save':
        return { task: service.save(decode(method, raw)) }
      case 'task-schedule/link':
        return { task: service.link(decode(method, raw)) }
      case 'task-schedule/plan':
        return { task: service.plan(decode(method, raw)) }
      case 'task-schedule/start':
        return { occurrence: await service.start(decode(method, raw)) }
      case 'task-schedule/result':
        return { occurrence: await service.submitResult(decode(method, raw)) }
      case 'task-schedule/accept':
        return { occurrence: await service.accept(decode(method, raw)) }
      case 'task-schedule/snooze':
        return { occurrence: service.snooze(decode(method, raw)) }
      case 'task-schedule/notify':
        return { occurrence: service.notify(decode(method, raw)) }
      case 'task-schedule/propose':
        return { proposal: service.propose(decode(method, raw)) }
      case 'task-schedule/arrange':
        return { proposal: service.arrange(decode(method, raw)) }
      default:
        return undefined
    }
  },
} satisfies RpcHandlerGroup
