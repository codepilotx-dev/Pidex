import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import { AGENT_LIVE_EVENT_FILTERS } from './EventSubscriptionFilters.js'
import type { DesktopPluginApi } from './Types.js'

type Dependencies = {
  mockClient: DesktopPluginApi
  hasAgentCapability: (
    name: Extract<
      ProtocolCapability,
      'plugins.details.v1' | 'plugins.lifecycle.v1' | 'plugins.assets.v1'
    >,
  ) => boolean
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'plugins.manage.v1' | 'plugins.lifecycle.v1'>,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call' | 'subscribeEnvelope'>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentPluginApi({
  hasAgentCapability,
  mockClient,
  requireAgentCapability,
  rpc,
  withAgentOrMock,
}: Dependencies): DesktopPluginApi {
  return {
    readPluginAsset: (pluginId, kind, workspacePath) =>
      withAgentOrMock(
        async () => {
          if (!hasAgentCapability('plugins.assets.v1')) return null
          return rpc.call('plugin/readAsset', {
            pluginId,
            kind,
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
        },
        () => mockClient.readPluginAsset(pluginId, kind, workspacePath),
      ),
    listPlugins: (workspacePath, forceReload) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('plugins.manage.v1')
          const result = await rpc.call('plugin/list', {
            ...(workspacePath ? { workspace: workspacePath } : {}),
            ...(forceReload === undefined ? {} : { forceReload }),
          })
          return {
            ...result,
            ...(!result.catalogError &&
            result.sections === undefined &&
            result.plugins.every((plugin) => plugin.inMarketplace === undefined)
              ? {
                  catalogError:
                    'Agent 未返回插件市场目录。请重启开发 Agent（bun run dev:agent）后刷新；开发模式不会自动重载 Agent 代码。',
                }
              : {}),
            plugins: result.plugins.map((plugin) => ({
              ...plugin,
              canInstall: plugin.canInstall === true && hasAgentCapability('plugins.lifecycle.v1'),
              canUninstall:
                plugin.canUninstall === true && hasAgentCapability('plugins.lifecycle.v1'),
            })),
          }
        },
        () => mockClient.listPlugins(workspacePath, forceReload),
      ),
    getPluginDetails: (pluginId, workspacePath) =>
      withAgentOrMock(
        async () => {
          if (!hasAgentCapability('plugins.details.v1')) return null
          return (
            await rpc.call('plugin/getDetails', {
              pluginId,
              ...(workspacePath ? { workspace: workspacePath } : {}),
            })
          ).details
        },
        () => mockClient.getPluginDetails(pluginId, workspacePath),
      ),
    installPlugin: (pluginId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('plugins.lifecycle.v1')
          return rpc.call('plugin/install', { pluginId, operationId: crypto.randomUUID() })
        },
        () => mockClient.installPlugin(pluginId),
      ),
    uninstallPlugin: (pluginId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('plugins.lifecycle.v1')
          return rpc.call('plugin/uninstall', { pluginId, operationId: crypto.randomUUID() })
        },
        () => mockClient.uninstallPlugin(pluginId),
      ),
    setPluginEnabled: (pluginId, enabled) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('plugins.manage.v1')
          return (
            await rpc.call('plugin/setEnabled', {
              pluginId,
              enabled,
              operationId: crypto.randomUUID(),
            })
          ).plugin
        },
        () => mockClient.setPluginEnabled(pluginId, enabled),
      ),
    onPluginsUpdated: (callback) =>
      rpc.subscribeEnvelope({ liveEventTypes: AGENT_LIVE_EVENT_FILTERS.plugins }, (events) => {
        for (const event of events) {
          if (event.type === 'plugins/updated') {
            callback(event.payload.generation)
          }
        }
      }),
  }
}
