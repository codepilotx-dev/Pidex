import type { ProtocolCapability, RpcParams } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopClient } from './Types.js'

type ProtocolDetectionApiMethod = 'detectProviderProtocols' | 'testProviderDraft'

type ProtocolDetectionApi = Pick<DesktopClient, ProtocolDetectionApiMethod>

type Dependencies = {
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'provider.protocolDetection.v1'>,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  mockClient: ProtocolDetectionApi
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

/**
 * 未保存草稿的临时探测：四协议矩阵检测与单模型可达性测试。两者都只携带
 * 请求期凭据，不写入配置、缓存、事件或日志。
 */
export function createAgentProtocolDetectionApi({
  requireAgentCapability,
  rpc,
  mockClient,
  withAgentOrMock,
}: Dependencies): ProtocolDetectionApi {
  return {
    detectProviderProtocols: (params) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('provider.protocolDetection.v1')
          return rpc.call('provider/protocol/detect', params)
        },
        () => mockClient.detectProviderProtocols(params),
      ),
    testProviderDraft: (input) =>
      withAgentOrMock(
        async () => {
          // `provider/test` 的 draft 分支要求显式 Model.Ref；未保存草稿没有真实
          // Provider ID，用合成标识只为满足 wire 契约，响应中的 providerId 应忽略。
          const providerId = input.providerId ?? DRAFT_PROVIDER_ID
          const model = {
            providerID: providerId,
            id: input.modelId,
          } as NonNullable<RpcParams<'provider/test'>['model']>
          return rpc.call('provider/test', {
            model,
            api: input.api,
            draft: input.draft,
            ...(input.providerId
              ? {
                  providerId: input.providerId as RpcParams<'provider/test'>['providerId'],
                }
              : {}),
          })
        },
        () => mockClient.testProviderDraft(input),
      ),
  }
}

/** 未保存草稿探测使用的合成 Provider ID；不参与持久化。 */
export const DRAFT_PROVIDER_ID = 'draft'
