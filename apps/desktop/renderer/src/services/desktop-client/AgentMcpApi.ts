import type { RpcResult } from '@pidex/agent-protocol'
import type { DesktopMcpServerListItem } from '../../../shared/Types.js'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopClient } from './Types.js'

type McpApiMethod =
  | 'listMcpServers'
  | 'getMcpRuntimeStatus'
  | 'saveMcpServer'
  | 'removeMcpServer'
  | 'setMcpServerEnabled'
  | 'reloadMcpConfiguration'
  | 'startMcpOAuth'
  | 'getMcpOAuthStatus'
  | 'logoutMcpOAuth'

type McpApi = Pick<DesktopClient, McpApiMethod>

type Dependencies = {
  mockClient: McpApi
  requireMcpManagementCapability: () => void
  requireMcpOAuthCapability: () => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

function desktopMcpServer(
  item: RpcResult<'mcp/list'>['servers'][number],
): DesktopMcpServerListItem {
  const server = item.server
  const summary =
    server.transport.type === 'stdio'
      ? [server.transport.command, ...(server.transport.args ?? [])].join(' ')
      : server.transport.url
  return {
    name: server.name,
    scope: server.scope,
    type: server.transport.type,
    summary,
    enabled: server.enabled,
    diagnosticContext: server.diagnosticContext ?? false,
    effective: item.effective,
    ...(item.shadowedByScope ? { shadowedByScope: item.shadowedByScope } : {}),
    editable: true,
    removable: true,
    transport: server.transport,
    ...(server.startupTimeoutMs ? { startupTimeoutMs: server.startupTimeoutMs } : {}),
    ...(server.toolTimeoutMs ? { toolTimeoutMs: server.toolTimeoutMs } : {}),
    ...(server.required !== undefined ? { required: server.required } : {}),
    ...(server.enabledTools ? { enabledTools: [...server.enabledTools] } : {}),
    ...(server.disabledTools ? { disabledTools: [...server.disabledTools] } : {}),
    ...(server.defaultToolsApprovalMode
      ? { defaultToolsApprovalMode: server.defaultToolsApprovalMode }
      : {}),
    ...(server.tools ? { tools: { ...server.tools } } : {}),
  }
}

export function createAgentMcpApi({
  mockClient,
  requireMcpManagementCapability,
  requireMcpOAuthCapability,
  rpc,
  withAgentOrMock,
}: Dependencies): McpApi {
  return {
    listMcpServers: (workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpManagementCapability()
          const result = await rpc.call<RpcResult<'mcp/list'>>(
            'mcp/list',
            workspacePath ? { workspace: workspacePath } : {},
          )
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.listMcpServers(workspacePath),
      ),
    getMcpRuntimeStatus: (workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpManagementCapability()
          return rpc.call<RpcResult<'mcp/status'>>(
            'mcp/status',
            workspacePath ? { workspace: workspacePath } : {},
          )
        },
        () => mockClient.getMcpRuntimeStatus(workspacePath),
      ),
    saveMcpServer: (options) =>
      withAgentOrMock(
        async () => {
          requireMcpManagementCapability()
          const result = await rpc.call<RpcResult<'mcp/save'>>('mcp/save', {
            operationId: crypto.randomUUID(),
            server: {
              name: options.name,
              scope: options.scope,
              enabled: options.enabled,
              ...(options.diagnosticContext ? { diagnosticContext: true } : {}),
              transport: options.transport,
              ...(options.startupTimeoutMs ? { startupTimeoutMs: options.startupTimeoutMs } : {}),
              ...(options.toolTimeoutMs ? { toolTimeoutMs: options.toolTimeoutMs } : {}),
              ...(options.required !== undefined ? { required: options.required } : {}),
              ...(options.enabledTools?.length ? { enabledTools: options.enabledTools } : {}),
              ...(options.disabledTools?.length ? { disabledTools: options.disabledTools } : {}),
              ...(options.defaultToolsApprovalMode
                ? {
                    defaultToolsApprovalMode: options.defaultToolsApprovalMode,
                  }
                : {}),
              ...(options.tools && Object.keys(options.tools).length
                ? { tools: options.tools }
                : {}),
            },
            ...(options.originalName ? { originalName: options.originalName } : {}),
            ...(options.workspacePath ? { workspace: options.workspacePath } : {}),
          })
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.saveMcpServer(options),
      ),
    removeMcpServer: (name, scope, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpManagementCapability()
          const result = await rpc.call<RpcResult<'mcp/remove'>>('mcp/remove', {
            name,
            scope,
            operationId: crypto.randomUUID(),
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.removeMcpServer(name, scope, workspacePath),
      ),
    setMcpServerEnabled: (name, scope, enabled, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpManagementCapability()
          const result = await rpc.call<RpcResult<'mcp/setEnabled'>>('mcp/setEnabled', {
            name,
            scope,
            enabled,
            operationId: crypto.randomUUID(),
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.setMcpServerEnabled(name, scope, enabled, workspacePath),
      ),
    reloadMcpConfiguration: (workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpManagementCapability()
          return rpc.call<RpcResult<'mcp/reload'>>('mcp/reload', {
            operationId: crypto.randomUUID(),
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
        },
        () => mockClient.reloadMcpConfiguration(workspacePath),
      ),
    startMcpOAuth: (name, scope, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpOAuthCapability()
          return rpc.call<RpcResult<'mcp/oauth/start'>>('mcp/oauth/start', {
            name,
            scope,
            operationId: crypto.randomUUID(),
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
        },
        () => mockClient.startMcpOAuth(name, scope, workspacePath),
      ),
    getMcpOAuthStatus: (attemptId) =>
      withAgentOrMock(
        async () => {
          requireMcpOAuthCapability()
          return rpc.call<RpcResult<'mcp/oauth/status'>>('mcp/oauth/status', { attemptId })
        },
        () => mockClient.getMcpOAuthStatus(attemptId),
      ),
    logoutMcpOAuth: (name, scope, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireMcpOAuthCapability()
          return rpc.call<RpcResult<'mcp/oauth/logout'>>('mcp/oauth/logout', {
            name,
            scope,
            operationId: crypto.randomUUID(),
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
        },
        () => mockClient.logoutMcpOAuth(name, scope, workspacePath),
      ),
  }
}
