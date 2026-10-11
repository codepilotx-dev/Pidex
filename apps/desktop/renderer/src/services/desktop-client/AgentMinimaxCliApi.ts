import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import { AGENT_LIVE_EVENT_FILTERS } from './EventSubscriptionFilters.js'
import type { DesktopMiniMaxCliApi } from './Types.js'

type Dependencies = {
  mockClient: DesktopMiniMaxCliApi
  requireAgentCapability: (name: Extract<ProtocolCapability, 'integrations.minimax-cli.v1'>) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call' | 'subscribeEnvelope'>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentMiniMaxCliApi({
  mockClient,
  requireAgentCapability,
  rpc,
  withAgentOrMock,
}: Dependencies): DesktopMiniMaxCliApi {
  return {
    getMiniMaxCliStatus: (forceReload) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('integrations.minimax-cli.v1')
          return rpc.call('minimaxCli/status', forceReload ? { forceReload: true } : {})
        },
        () => mockClient.getMiniMaxCliStatus(forceReload),
      ),
    installMiniMaxCli: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('integrations.minimax-cli.v1')
          return rpc.call('minimaxCli/install', { operationId: crypto.randomUUID() })
        },
        () => mockClient.installMiniMaxCli(),
      ),
    uninstallMiniMaxCli: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('integrations.minimax-cli.v1')
          return rpc.call('minimaxCli/uninstall', { operationId: crypto.randomUUID() })
        },
        () => mockClient.uninstallMiniMaxCli(),
      ),
    onMiniMaxCliUpdated: (callback) =>
      rpc.subscribeEnvelope({ liveEventTypes: AGENT_LIVE_EVENT_FILTERS.minimaxCli }, (events) => {
        for (const event of events) {
          if (event.type === 'minimaxCli/updated') callback(event.payload.status)
        }
      }),
  }
}
