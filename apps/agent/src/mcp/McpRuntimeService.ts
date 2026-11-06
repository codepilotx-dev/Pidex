import type {
  McpReloadResultSchema,
  McpRuntimeServerStatus,
  McpScope,
  McpServerDeclaration,
} from '@pidex/agent-protocol'
import { McpConfigError, McpConfigService, isMcpSettingsConflict } from './McpConfigService'
import { McpConnectionManager } from './McpConnectionManager'
import { McpOAuthError, McpOAuthService } from './McpOAuthService'

type McpReloadResult = typeof McpReloadResultSchema.Type

export class McpRuntimeError extends Error {
  constructor(
    readonly code:
      | 'MCP_CONFIG_INVALID'
      | 'MCP_SERVER_NOT_FOUND'
      | 'MCP_OAUTH_UNAVAILABLE'
      | 'MCP_UNAVAILABLE'
      | 'PATH_DENIED'
      | 'CONFLICT',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class McpRuntimeService {
  private readonly reloadOperations = new Map<
    string,
    { fingerprint: string; result: McpReloadResult }
  >()

  constructor(
    private readonly configs: McpConfigService,
    readonly connections: McpConnectionManager,
    readonly oauth?: McpOAuthService,
    /**
     * Plugin adapters report their runtime status alongside ordinary MCP connections.
     */
    private readonly hostManaged?: (
      workspace?: string,
    ) => McpRuntimeServerStatus[] | Promise<McpRuntimeServerStatus[]>,
    private readonly defaults?: () => McpServerDeclaration[],
  ) {}

  list(input: { workspace?: string }) {
    return this.wrap(async () => {
      const result = await this.configs.list(input.workspace)
      const names = new Set(result.servers.map((item) => item.server.name))
      return {
        ...result,
        servers: [
          ...result.servers,
          ...(this.defaults?.() ?? [])
            .filter((server) => !names.has(server.name))
            .map((server) => ({ server, effective: true, providedDefault: true })),
        ],
      }
    })
  }

  async status(input: { workspace?: string }) {
    const result = await this.wrap(() => this.connections.status(input.workspace))
    const hostServers = (await this.hostManaged?.(input.workspace)) ?? []
    if (hostServers.length === 0) return result
    return {
      ...result,
      servers: [...hostServers, ...result.servers],
      totalTools:
        result.totalTools + hostServers.reduce((total, item) => total + item.toolCount, 0),
    }
  }

  async save(input: {
    workspace?: string
    originalName?: string
    server: McpServerDeclaration
    operationId: string
  }) {
    return this.wrap(async () => {
      if (input.server.name === 'node_repl' && input.server.transport.type !== 'stdio')
        throw new McpRuntimeError('MCP_CONFIG_INVALID', 'node_repl 仅支持 stdio MCP', 400)
      if (
        input.server.name === 'node_repl' &&
        (input.server.required || input.server.diagnosticContext)
      )
        throw new McpRuntimeError(
          'MCP_CONFIG_INVALID',
          'node_repl 是可选电脑控制入口，不支持必需 Server 或会话诊断选项',
          400,
        )
      if (input.originalName === 'node_repl' && input.server.name !== 'node_repl')
        throw new McpRuntimeError(
          'MCP_CONFIG_INVALID',
          'Computer Use 的 MCP 名称必须保留 node_repl',
          400,
        )
      const existing = (await this.configs.list(input.workspace)).servers.find(
        (item) =>
          item.server.scope === input.server.scope &&
          item.server.name === (input.originalName ?? input.server.name),
      )?.server
      const result = await this.configs.save(input)
      const changedIdentity =
        existing?.transport.type === 'http' &&
        (input.server.transport.type !== 'http' ||
          existing.name !== input.server.name ||
          existing.transport.url !== input.server.transport.url)
      if (changedIdentity) {
        await this.oauth?.invalidateDeclaration(existing, input.workspace)
      }
      return result
    })
  }

  async remove(input: { workspace?: string; scope: McpScope; name: string; operationId: string }) {
    return this.wrap(async () => {
      const existing = (await this.configs.list(input.workspace)).servers.find(
        (item) => item.server.scope === input.scope && item.server.name === input.name,
      )?.server
      const result = await this.configs.remove(input)
      if (existing) {
        await this.oauth?.invalidateDeclaration(existing, input.workspace)
      }
      return result
    })
  }

  setEnabled(input: {
    workspace?: string
    scope: McpScope
    name: string
    enabled: boolean
    operationId: string
  }) {
    return this.wrap(async () => {
      const existing = (await this.configs.list(input.workspace)).servers.some(
        (item) => item.server.scope === input.scope && item.server.name === input.name,
      )
      const fallback = this.defaults?.().find(
        (server) => server.name === input.name && server.scope === input.scope,
      )
      if (!existing && fallback)
        return this.configs.save({ ...input, server: { ...fallback, enabled: input.enabled } })
      return this.configs.setEnabled(input)
    })
  }

  async reload(input: { workspace?: string; operationId: string }) {
    const fingerprint = JSON.stringify({ workspace: input.workspace ?? null })
    const existing = this.reloadOperations.get(input.operationId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new McpRuntimeError('CONFLICT', 'operationId 已用于其他 MCP 重载请求', 409)
      }
      return existing.result
    }
    const result = await this.wrap(() => this.connections.reload(input.workspace))
    this.reloadOperations.set(input.operationId, { fingerprint, result })
    if (this.reloadOperations.size > 100) {
      this.reloadOperations.delete(this.reloadOperations.keys().next().value!)
    }
    return result
  }

  oauthStart(input: { workspace?: string; scope: McpScope; name: string; operationId: string }) {
    if (!this.oauth) {
      throw new McpRuntimeError('MCP_OAUTH_UNAVAILABLE', 'MCP OAuth 服务未配置', 503)
    }
    return this.wrap(() => this.oauth!.start(input))
  }

  oauthStatus(input: { attemptId: string }) {
    if (!this.oauth) {
      throw new McpRuntimeError('MCP_OAUTH_UNAVAILABLE', 'MCP OAuth 服务未配置', 503)
    }
    return this.oauth.status(input)
  }

  oauthLogout(input: { workspace?: string; scope: McpScope; name: string; operationId: string }) {
    if (!this.oauth) {
      throw new McpRuntimeError('MCP_OAUTH_UNAVAILABLE', 'MCP OAuth 服务未配置', 503)
    }
    return this.wrap(() => this.oauth!.logout(input))
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (cause) {
      if (cause instanceof McpRuntimeError) throw cause
      if (cause instanceof McpConfigError) {
        throw new McpRuntimeError(cause.code, cause.message, cause.status)
      }
      if (cause instanceof McpOAuthError) {
        throw new McpRuntimeError(cause.code, cause.message, cause.status)
      }
      if (isMcpSettingsConflict(cause)) {
        throw new McpRuntimeError(
          'CONFLICT',
          cause instanceof Error ? cause.message : 'MCP 设置冲突',
          409,
        )
      }
      throw cause
    }
  }
}
