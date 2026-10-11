import type { RpcMethod } from '@pidex/agent-protocol'
import { RpcMethods } from '@pidex/agent-protocol'
import { AgentError } from '../../../Domain'
import {
  LocalEnvironmentActionListParamsSchema,
  LocalEnvironmentReadParamsSchema,
  LocalEnvironmentUpdateParamsSchema,
  TerminalHostActionResolveParamsSchema,
  TerminalHostEnvironmentParamsSchema,
} from '@pidex/agent-protocol/local-environment'
import { Schema } from 'effect'
import type { ConfigValue } from '../../../config/ConfigService'
import type { RpcRouter } from '../RpcRouter'
import { decodeRpcParams } from '../Decoders'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeRead = Schema.decodeUnknownSync(LocalEnvironmentReadParamsSchema)
const decodeUpdate = Schema.decodeUnknownSync(LocalEnvironmentUpdateParamsSchema)
const decodeActions = Schema.decodeUnknownSync(LocalEnvironmentActionListParamsSchema)
const decodeHostEnvironment = Schema.decodeUnknownSync(TerminalHostEnvironmentParamsSchema)
const decodeHostAction = Schema.decodeUnknownSync(TerminalHostActionResolveParamsSchema)

export const localEnvironmentHandlers = {
  name: 'local-environment',
  methods: [
    'local-environment/read',
    'local-environment/project/list',
    'local-environment/project/read',
    'local-environment/project/create',
    'local-environment/project/update',
    'local-environment/project/select',
    'local-environment/project/delete',
    'local-environment/update',
    'local-environment/action/list',
    'terminal/host/environment',
    'terminal/host/action/resolve',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    context: RpcRouterContext,
  ) {
    const service = runtime.dependencies.localEnvironment
    switch (method) {
      case 'local-environment/project/list':
      case 'local-environment/project/read':
      case 'local-environment/project/create':
      case 'local-environment/project/update':
      case 'local-environment/project/select':
      case 'local-environment/project/delete': {
        const catalog = service.catalog
        if (!catalog) throw new AgentError('INTERNAL_ERROR', '环境目录服务不可用', 500)
        switch (method) {
          case 'local-environment/project/list': {
            const params = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
            return catalog.list(params.projectId)
          }
          case 'local-environment/project/read': {
            const params = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
            return catalog.read(params.projectId, params.environmentId)
          }
          case 'local-environment/project/create': {
            const params = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
            return catalog.create(params.projectId, params.name)
          }
          case 'local-environment/project/update': {
            const params = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
            return catalog.update({
              projectId: params.projectId,
              environmentId: params.environmentId,
              expectedRevision: params.expectedRevision,
              ...(params.edits
                ? {
                    edits: params.edits.map((edit) => ({
                      keyPath: [...edit.keyPath],
                      value: JSON.parse(JSON.stringify(edit.value)) as ConfigValue,
                    })),
                  }
                : {}),
              ...(params.trust ? { trust: params.trust } : {}),
            })
          }
          case 'local-environment/project/select': {
            const params = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
            await catalog.select(params.projectId, params.environmentId)
            return
          }
          case 'local-environment/project/delete': {
            const params = Schema.decodeUnknownSync(RpcMethods[method].params)(rawParams)
            await catalog.delete(params.projectId, params.environmentId, params.expectedRevision)
            return
          }
        }
      }
      case 'local-environment/read':
        return service.readForThread(decodeRpcParams(decodeRead, rawParams, method).threadId)
      case 'local-environment/update': {
        const params = decodeRpcParams(decodeUpdate, rawParams, method)
        return service.updateForThread({
          threadId: params.threadId,
          expectedRevision: params.expectedRevision,
          ...(params.edits
            ? {
                edits: params.edits.map((edit) => ({
                  keyPath: [...edit.keyPath],
                  value: JSON.parse(JSON.stringify(edit.value)) as ConfigValue,
                })),
              }
            : {}),
          ...(params.trust ? { trust: params.trust } : {}),
        })
      }
      case 'local-environment/action/list':
        return service.actionListForThread(
          decodeRpcParams(decodeActions, rawParams, method).threadId,
        )
      case 'terminal/host/environment': {
        runtime.requireDesktopHost(context)
        return service.hostEnvironment(
          decodeRpcParams(decodeHostEnvironment, rawParams, method).threadId,
        )
      }
      case 'terminal/host/action/resolve': {
        runtime.requireDesktopHost(context)
        const params = decodeRpcParams(decodeHostAction, rawParams, method)
        return service.hostResolveAction(params.threadId, params.actionName)
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
