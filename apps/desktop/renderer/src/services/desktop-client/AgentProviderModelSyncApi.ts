import type { ProtocolCapability, RpcParams } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopClient } from './Types.js'

type ProviderModelSyncApiMethod = 'syncProviderModels' | 'discoverProviderModels'

type ProviderModelSyncApi = Pick<DesktopClient, ProviderModelSyncApiMethod>

type Dependencies = {
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'provider.modelSync.v1' | 'provider.config.pi.v1'>,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  mockClient: ProviderModelSyncApi
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

/**
 * 上游模型列表读取与立即同步。同步是 Provider 配置写操作，走
 * `provider.modelSync.v1`；保存前获取（draft）与已保存 Provider 的列表读取
 * 仍属于 `provider.config.pi.v1`，不额外引入新能力。
 */
export function createAgentProviderModelSyncApi({
  requireAgentCapability,
  rpc,
  mockClient,
  withAgentOrMock,
}: Dependencies): ProviderModelSyncApi {
  return {
    syncProviderModels: (providerId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('provider.modelSync.v1')
          return rpc.call('provider/model/sync', {
            providerId: providerId as RpcParams<'provider/model/sync'>['providerId'],
          })
        },
        () => mockClient.syncProviderModels(providerId),
      ),
    discoverProviderModels: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('provider.config.pi.v1')
          const params: RpcParams<'provider/model/discover'> = {
            api: input.api,
            ...(input.providerId
              ? {
                  providerId:
                    input.providerId as RpcParams<'provider/model/discover'>['providerId'],
                }
              : {}),
            ...(input.draft ? { draft: input.draft } : {}),
          }
          const result = await rpc.call('provider/model/discover', params)
          return [...result.models]
        },
        () => mockClient.discoverProviderModels(input),
      ),
  }
}
