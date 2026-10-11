import type { ProtocolCapability, RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import { AGENT_LIVE_EVENT_FILTERS } from './EventSubscriptionFilters.js'
import type { DesktopComputerApi } from './Types.js'

type Dependencies = {
  mockClient: DesktopComputerApi
  requireAgentCapability: (name: Extract<ProtocolCapability, 'computer.use.v1'>) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call' | 'subscribeEnvelope'>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentComputerApi({
  mockClient,
  requireAgentCapability,
  rpc,
  withAgentOrMock,
}: Dependencies): DesktopComputerApi {
  const call = <T>(operation: () => Promise<T>, fallback: () => Promise<T>) =>
    withAgentOrMock(async () => {
      requireAgentCapability('computer.use.v1')
      return operation()
    }, fallback)
  return {
    getComputerState: () => call(() => rpc.call('computer/state', {}), mockClient.getComputerState),
    discoverComputerApps: () =>
      call(() => rpc.call('computer/apps', {}), mockClient.discoverComputerApps),
    configureComputer: (input: RpcParams<'computer/configure'>) =>
      call(
        () => rpc.call('computer/configure', input),
        () => mockClient.configureComputer(input),
      ),
    stopComputer: () => call(() => rpc.call('computer/stop', {}), mockClient.stopComputer),
    onComputerChanged: (callback) =>
      rpc.subscribeEnvelope({ liveEventTypes: AGENT_LIVE_EVENT_FILTERS.computer }, (events) => {
        let latest: RpcResult<'computer/state'> | undefined
        for (const event of events) {
          if (event.type === 'computer/changed') latest = event.payload
        }
        if (latest) callback(latest)
      }),
  }
}
