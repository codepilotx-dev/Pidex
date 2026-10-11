import { AutomationRpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const methods = Object.keys(AutomationRpcMethods) as Array<keyof typeof AutomationRpcMethods>
const decode = (method: keyof typeof AutomationRpcMethods, raw: unknown) =>
  Schema.decodeUnknownSync(AutomationRpcMethods[method].params as any)(raw) as any

export const automationHandlers = {
  name: 'automation',
  methods,
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    if (!(method in AutomationRpcMethods)) return undefined
    const params = decode(method as keyof typeof AutomationRpcMethods, rawParams)
    const service = runtime.dependencies.automation
    switch (method) {
      case 'automation/list':
        return { automations: service.list(params) }
      case 'automation/read':
        return { automation: service.read(params.automationId) }
      case 'automation/create':
        return { automation: await service.create(params) }
      case 'automation/update': {
        const { automationId, ...patch } = params
        return { automation: await service.update(automationId, patch) }
      }
      case 'automation/delete':
        return { automation: await service.delete(params.automationId, params.expectedRevision) }
      case 'automation/run':
        return { run: await service.runNow(params.automationId, params.operationId) }
      case 'automation/run/list':
        return { runs: service.listRuns(params) }
      case 'automation/run/mark-read':
        return { run: service.markRunRead(params.runId) }
      case 'automation/run/mark-all-read':
        return { updatedCount: service.markAllRunsRead(params.automationId) }
      case 'automation/schedule/preview':
        return { preview: service.preview(params.schedule, params.timeZone, params.count) }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
