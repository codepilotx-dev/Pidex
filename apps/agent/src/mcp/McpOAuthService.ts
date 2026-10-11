import type { McpRuntimeServerAuth, McpScope } from '@pidex/agent-protocol'
import { McpConfigService } from './McpConfigService'
import { McpConnectionManager } from './McpConnectionManager'
import { McpOAuthCoordinator, type McpOAuthHttpServer } from './McpOAuthCoordinator'

export class McpOAuthError extends Error {
  constructor(
    readonly code:
      'MCP_CONFIG_INVALID' | 'MCP_SERVER_NOT_FOUND' | 'MCP_OAUTH_UNAVAILABLE' | 'CONFLICT',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class McpOAuthService {
  private readonly attempts = new Map<string, { workspace?: string }>()
  private readonly operations = new Map<string, { fingerprint: string; result: unknown }>()

  constructor(
    private readonly configs: McpConfigService,
    private readonly connections: McpConnectionManager,
    readonly coordinator: McpOAuthCoordinator,
  ) {}

  async start(input: { workspace?: string; scope: McpScope; name: string; operationId: string }) {
    const fingerprint = JSON.stringify({
      action: 'start',
      workspace: input.workspace ?? null,
      scope: input.scope,
      name: input.name,
    })
    const previous = this.operation(input.operationId, fingerprint)
    if (previous)
      return previous as {
        attemptId: string
        authorizationUrl: string
        expiresAt: number
      }
    const { server, workspaceHash } = await this.server(input, true)
    const result = await this.coordinator.start(server, workspaceHash)
    this.attempts.set(result.attemptId, input.workspace ? { workspace: input.workspace } : {})
    this.remember(input.operationId, fingerprint, result)
    return result
  }

  status(input: { attemptId: string }) {
    const status = this.coordinator.status(input.attemptId)
    if (status.state !== 'pending') {
      this.attempts.delete(input.attemptId)
    }
    return status
  }

  async logout(input: { workspace?: string; scope: McpScope; name: string; operationId: string }) {
    const fingerprint = JSON.stringify({
      action: 'logout',
      workspace: input.workspace ?? null,
      scope: input.scope,
      name: input.name,
    })
    const previous = this.operation(input.operationId, fingerprint)
    if (previous) return previous as { generation: number }
    const { server, workspaceHash } = await this.server(input, false)
    await this.coordinator.remove(server, workspaceHash)
    const reload = await this.connections.reload(input.workspace)
    const result = { generation: reload.generation }
    this.remember(input.operationId, fingerprint, result)
    return result
  }

  async authSummary(
    server: McpOAuthHttpServer,
    workspaceHash?: string,
  ): Promise<McpRuntimeServerAuth> {
    return this.coordinator.authSummary(server, workspaceHash)
  }

  async invalidateDeclaration(
    server: { scope: McpScope; name: string; transport: { type: string } } & Record<
      string,
      unknown
    >,
    workspace?: string,
  ) {
    if (server.transport.type !== 'http') return
    const identity = await this.configs.workspace(workspace)
    await this.coordinator.remove(server as McpOAuthHttpServer, identity?.hash)
  }

  async handleCallback(input: { code?: string; state?: string; error?: string }) {
    const result = await this.coordinator.handleCallback(input)
    if (!result.attemptId) return false
    const context = this.attempts.get(result.attemptId)
    if (result.completed) {
      await this.connections.reload(context?.workspace)
    }
    this.attempts.delete(result.attemptId)
    return result.completed
  }

  private async server(
    input: { workspace?: string; scope: McpScope; name: string },
    requireEffective: boolean,
  ) {
    const identity = await this.configs.workspace(input.workspace)
    const list = await this.configs.list(input.workspace)
    const item = list.servers.find(
      (candidate) => candidate.server.scope === input.scope && candidate.server.name === input.name,
    )
    if (!item) {
      throw new McpOAuthError('MCP_SERVER_NOT_FOUND', 'MCP server 不存在', 404)
    }
    if (item.server.transport.type !== 'http' || item.server.transport.auth === 'none') {
      throw new McpOAuthError('MCP_OAUTH_UNAVAILABLE', '此 MCP server 不支持 OAuth', 400)
    }
    if (requireEffective && (!item.effective || !item.server.enabled)) {
      throw new McpOAuthError('MCP_OAUTH_UNAVAILABLE', '只能认证当前生效且已启用的 MCP server', 409)
    }
    return {
      server: item.server as McpOAuthHttpServer,
      ...(identity ? { workspaceHash: identity.hash } : {}),
    }
  }

  private operation(operationId: string, fingerprint: string) {
    const existing = this.operations.get(operationId)
    if (!existing) return null
    if (existing.fingerprint !== fingerprint) {
      throw new McpOAuthError('CONFLICT', 'operationId 已用于其他 MCP OAuth 请求', 409)
    }
    return existing.result
  }

  private remember(operationId: string, fingerprint: string, result: unknown) {
    this.operations.set(operationId, { fingerprint, result })
    if (this.operations.size > 100) {
      this.operations.delete(this.operations.keys().next().value!)
    }
  }
}
