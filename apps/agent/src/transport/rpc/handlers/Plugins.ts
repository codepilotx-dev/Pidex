import {
  PluginGetDetailsParamsSchema,
  PluginListParamsSchema,
  PluginSetEnabledParamsSchema,
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

export const pluginHandlers = {
  name: 'plugins',
  methods: ['plugin/list', 'plugin/getDetails', 'plugin/setEnabled'],
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
