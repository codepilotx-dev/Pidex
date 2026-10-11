import { WorkflowRpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'

const methods = Object.keys(WorkflowRpcMethods) as Array<keyof typeof WorkflowRpcMethods>
const decode = (method: keyof typeof WorkflowRpcMethods, raw: unknown) =>
  Schema.decodeUnknownSync(WorkflowRpcMethods[method].params as never)(raw) as any
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key === 'groupId' ? 'workflowId' : key,
            canonical(item),
          ]),
        )
      : value

export const workflowHandlers = {
  name: 'workflow',
  methods: methods as readonly RpcMethod[],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    if (!(method in WorkflowRpcMethods)) return undefined
    const params = decode(method as keyof typeof WorkflowRpcMethods, rawParams)
    const service = runtime.dependencies.sessionGroups
    switch (method) {
      case 'workflow/list': {
        const result = (await service.list()) as any
        return { workflows: canonical(result.groups), nextCursor: result.nextCursor }
      }
      case 'workflow/read': {
        const result = (await service.read(params.workflowId)) as any
        return { workflow: result.group, memberships: canonical(result.memberships) }
      }
      case 'workflow/create': {
        const result = (await service.create(params)) as any
        return { workflow: result.group }
      }
      case 'workflow/update': {
        const result = (await service.update({
          groupId: params.workflowId,
          expectedVersion: params.expectedVersion,
          operationId: params.operationId,
          ...params.patch,
        })) as any
        return { workflow: result.group }
      }
      case 'workflow/delete': {
        const result = (await service.delete({
          groupId: params.workflowId,
          expectedVersion: params.expectedVersion,
          operationId: params.operationId,
        })) as any
        return { workflowId: result.groupId, deletedAt: result.deletedAt }
      }
      case 'workflow/membership/set':
        return canonical(
          await service.setMembership({
            threadId: params.threadId,
            groupId: params.workflowId,
            operationId: params.operationId,
          }),
        )
      case 'workflow/context/read':
        return canonical(await service.context(params.workflowId, params.sections))
      case 'workflow/context/update':
        return canonical(
          await service.applyContextChanges({ ...params, groupId: params.workflowId }),
        )
      case 'workflow/step/list':
        return canonical(await service.listSteps(params.workflowId, params.limit))
      case 'workflow/step/diff': {
        const source = service.diffSource({
          groupId: params.workflowId,
          stepId: params.stepId,
          ...(params.path ? { path: params.path } : {}),
        })
        const paths = params.path
          ? [params.path]
          : source.step.changedFiles.map((file) => file.path)
        return {
          stepId: params.stepId,
          files: paths.map((path) => {
            const target = service.diffSource({
              groupId: params.workflowId,
              stepId: params.stepId,
              path,
            })
            return {
              workspaceLabel: target.workspaceLabel,
              ...runtime.dependencies.turnPatches.readDiff(target),
            }
          }),
        }
      }
      default:
        return undefined
    }
  },
}
