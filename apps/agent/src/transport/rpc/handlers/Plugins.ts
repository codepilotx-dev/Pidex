import {
  PluginGetDetailsParamsSchema,
  PluginRpcMethods,
  PluginListParamsSchema,
  PluginSetEnabledParamsSchema,
  PluginLifecycleParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import { PluginManagementError } from '../../../plugin/PluginManagementService'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeList = Schema.decodeUnknownSync(PluginListParamsSchema)
const decodeGetDetails = Schema.decodeUnknownSync(PluginGetDetailsParamsSchema)
const decodeSetEnabled = Schema.decodeUnknownSync(PluginSetEnabledParamsSchema)
const decodeLifecycle = Schema.decodeUnknownSync(PluginLifecycleParamsSchema)

export const pluginHandlers = {
  name: 'plugins',
  methods: [
    'plugin/readAsset',
    'plugin/list',
    'plugin/getDetails',
    'plugin/setEnabled',
    'plugin/install',
    'plugin/uninstall',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const plugins = runtime.dependencies.plugins
    if (!plugins) throw new AgentError('INTERNAL_ERROR', '插件管理服务未配置', 500)
    try {
      switch (method) {
        case 'plugin/readAsset':
          return await plugins.readAsset(
            Schema.decodeUnknownSync(PluginRpcMethods['plugin/readAsset'].params)(rawParams),
          )
        case 'plugin/install':
          return await plugins.install(decodeLifecycle(rawParams))
        case 'plugin/uninstall':
          return await plugins.uninstall(decodeLifecycle(rawParams))
        case 'plugin/list':
          return plugins.list(decodeList(rawParams))
        case 'plugin/getDetails':
          return plugins.getDetails(decodeGetDetails(rawParams))
        case 'plugin/setEnabled': {
          const result = await plugins.setEnabled(decodeSetEnabled(rawParams))
          return result.result
        }
        default:
          return undefined
      }
    } catch (cause) {
      if (cause instanceof PluginManagementError) {
        throw new AgentError(cause.code, cause.message, cause.status)
      }
      throw cause
    }
  },
} as const satisfies RpcHandlerGroup
