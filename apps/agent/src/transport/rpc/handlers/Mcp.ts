import {
  McpListParamsSchema,
  McpOAuthServerParamsSchema,
  McpOAuthStatusParamsSchema,
  McpReloadParamsSchema,
  McpRemoveParamsSchema,
  McpSaveParamsSchema,
  McpSetEnabledParamsSchema,
  McpStatusParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import { McpRuntimeError } from '../../../mcp/McpRuntimeService'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeList = Schema.decodeUnknownSync(McpListParamsSchema)
const decodeStatus = Schema.decodeUnknownSync(McpStatusParamsSchema)
const decodeSave = Schema.decodeUnknownSync(McpSaveParamsSchema)
const decodeRemove = Schema.decodeUnknownSync(McpRemoveParamsSchema)
const decodeEnabled = Schema.decodeUnknownSync(McpSetEnabledParamsSchema)
const decodeReload = Schema.decodeUnknownSync(McpReloadParamsSchema)
const decodeOAuthServer = Schema.decodeUnknownSync(McpOAuthServerParamsSchema)
const decodeOAuthStatus = Schema.decodeUnknownSync(McpOAuthStatusParamsSchema)

export const mcpHandlers = {
  name: 'mcp',
  methods: [
    'mcp/list',
    'mcp/status',
    'mcp/save',
    'mcp/remove',
    'mcp/setEnabled',
    'mcp/reload',
    'mcp/oauth/start',
    'mcp/oauth/status',
    'mcp/oauth/logout',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const mcp = runtime.dependencies.mcp
    if (!mcp) throw new AgentError('MCP_UNAVAILABLE', 'MCP 管理服务未配置', 503)
    try {
      switch (method) {
        case 'mcp/list': {
          const params = decodeList(rawParams)
          return mcp.list(params.workspace ? { workspace: params.workspace } : {})
        }
        case 'mcp/status': {
          const params = decodeStatus(rawParams)
          return mcp.status(params.workspace ? { workspace: params.workspace } : {})
        }
        case 'mcp/save': {
          const params = decodeSave(rawParams)
          const result = await mcp.save({
            operationId: params.operationId,
            server: params.server,
            ...(params.workspace ? { workspace: params.workspace } : {}),
            ...(params.originalName ? { originalName: params.originalName } : {}),
          })
          if (result.changed) await runtime.emit('mcp/updated', { generation: result.generation })
          return { servers: result.servers, generation: result.generation }
        }
        case 'mcp/remove': {
          const params = decodeRemove(rawParams)
          const result = await mcp.remove({
            operationId: params.operationId,
            scope: params.scope,
            name: params.name,
            ...(params.workspace ? { workspace: params.workspace } : {}),
          })
          if (result.changed) await runtime.emit('mcp/updated', { generation: result.generation })
          return { servers: result.servers, generation: result.generation }
        }
        case 'mcp/setEnabled': {
          const params = decodeEnabled(rawParams)
          const result = await mcp.setEnabled({
            operationId: params.operationId,
            scope: params.scope,
            name: params.name,
            enabled: params.enabled,
            ...(params.workspace ? { workspace: params.workspace } : {}),
          })
          if (result.changed) await runtime.emit('mcp/updated', { generation: result.generation })
          return { servers: result.servers, generation: result.generation }
        }
        case 'mcp/reload': {
          const params = decodeReload(rawParams)
          return mcp.reload({
            operationId: params.operationId,
            ...(params.workspace ? { workspace: params.workspace } : {}),
          })
        }
        case 'mcp/oauth/start': {
          const params = decodeOAuthServer(rawParams)
          return mcp.oauthStart({
            operationId: params.operationId,
            scope: params.scope,
            name: params.name,
            ...(params.workspace ? { workspace: params.workspace } : {}),
          })
        }
        case 'mcp/oauth/status':
          return mcp.oauthStatus(decodeOAuthStatus(rawParams))
        case 'mcp/oauth/logout': {
          const params = decodeOAuthServer(rawParams)
          const result = await mcp.oauthLogout({
            operationId: params.operationId,
            scope: params.scope,
            name: params.name,
            ...(params.workspace ? { workspace: params.workspace } : {}),
          })
          return result
        }
        default:
          return undefined
      }
    } catch (cause) {
      if (cause instanceof McpRuntimeError) {
        throw new AgentError(cause.code, cause.message, cause.status)
      }
      throw cause
    }
  },
} as const satisfies RpcHandlerGroup
