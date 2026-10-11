import type { ProtocolCapability, RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { DesktopModelRef, ModelProviderID } from '../../../shared/Types.js'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopClient } from './Types.js'

type ModelHealthApiMethod =
  | 'previewModelHealth'
  | 'startModelHealth'
  | 'readModelHealth'
  | 'cancelModelHealth'
  | 'testModelProvider'

type ModelHealthApi = Pick<DesktopClient, ModelHealthApiMethod>

type Dependencies = {
  requireAgentCapability: (name: Extract<ProtocolCapability, 'model.health.v1'>) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  mockClient: ModelHealthApi
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentModelHealthApi({
  requireAgentCapability,
  rpc,
  mockClient,
  withAgentOrMock,
}: Dependencies): ModelHealthApi {
  return {
    previewModelHealth: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('model.health.v1')
          return rpc.call('model/health/preview', {})
        },
        () => mockClient.previewModelHealth(),
      ),
    startModelHealth: (operationId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('model.health.v1')
          return rpc.call('model/health/start', {
            operationId: operationId as RpcParams<'model/health/start'>['operationId'],
          })
        },
        () => mockClient.startModelHealth(operationId),
      ),
    readModelHealth: (runId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('model.health.v1')
          return rpc.call('model/health/read', {
            runId: runId as RpcParams<'model/health/read'>['runId'],
          })
        },
        () => mockClient.readModelHealth(runId),
      ),
    cancelModelHealth: (runId, operationId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('model.health.v1')
          return rpc.call('model/health/cancel', {
            runId: runId as RpcParams<'model/health/cancel'>['runId'],
            operationId: operationId as RpcParams<'model/health/cancel'>['operationId'],
          })
        },
        () => mockClient.cancelModelHealth(runId, operationId),
      ),
    testModelProvider: (providerID, model) =>
      withAgentOrMock(
        async () => {
          const params: RpcParams<'provider/test'> = {
            providerId: providerID as RpcParams<'provider/test'>['providerId'],
            ...(model
              ? {
                  model: model as RpcParams<'provider/test'>['model'],
                }
              : {}),
          }
          return rpc.call('provider/test', params)
        },
        () => mockClient.testModelProvider(providerID, model),
      ),
  }
}

export type { ModelProviderID, DesktopModelRef, RpcResult }
