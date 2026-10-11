import { SessionGroupRpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'

const methods = Object.keys(SessionGroupRpcMethods) as Array<keyof typeof SessionGroupRpcMethods>
const decode = (method: keyof typeof SessionGroupRpcMethods, raw: unknown) =>
  Schema.decodeUnknownSync(SessionGroupRpcMethods[method].params as never)(raw) as any

export const sessionGroupHandlers = {
  name: 'session-group',
  methods: methods as readonly RpcMethod[],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    if (!(method in SessionGroupRpcMethods)) return undefined
    const params = decode(method as keyof typeof SessionGroupRpcMethods, rawParams)
    const service = runtime.dependencies.sessionGroups
    switch (method) {
      case 'session-group/list':
        return service.list()
      case 'session-group/read':
        return service.read(params.groupId)
      case 'session-group/create':
        return service.create(params)
      case 'session-group/update':
        return service.update({
          groupId: params.groupId,
          expectedVersion: params.expectedVersion,
          operationId: params.operationId,
          ...params.patch,
        })
      case 'session-group/delete':
        return service.delete(params)
      case 'session-group/membership/set':
        return service.setMembership(params)
      case 'session-group/context/read':
        return service.context(params.groupId, params.sections)
      case 'session-group/context/update':
        return service.applyContextChanges(params)
      case 'session-group/step/list':
        return service.listSteps(params.groupId, params.limit)
      case 'session-group/step/diff': {
        const source = service.diffSource(params)
        const paths = params.path
          ? [params.path]
          : source.step.changedFiles.map((file) => file.path)
        return {
          stepId: params.stepId,
          files: paths.map((path) => {
            const target = service.diffSource({ ...params, path })
            const diff = runtime.dependencies.turnPatches.readDiff(target)
            return { workspaceLabel: target.workspaceLabel, ...diff }
          }),
        }
      }
      default:
        return undefined
    }
  },
}
