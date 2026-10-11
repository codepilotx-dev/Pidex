import type { ProtocolCapability, RpcParams } from '@pidex/agent-protocol'
import type {
  DesktopModelProviderState,
  DesktopProviderCredential,
  ModelProviderID,
} from '../../../shared/Types.js'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopClient } from './Types.js'

type ProviderCredentialApiMethod =
  | 'listProviderCredentials'
  | 'saveProviderApiKey'
  | 'deleteProviderApiKey'
  | 'readProviderCredentialStore'
  | 'updateProviderCredentialStore'
  | 'createApiKey'
  | 'updateApiKey'
  | 'setActiveProviderCredential'
  | 'setProviderCredentialEnabled'
  | 'reorderApiKeys'
  | 'testApiKey'
  | 'deleteProviderCredential'

type ProviderCredentialApi = Pick<DesktopClient, ProviderCredentialApiMethod>

type Dependencies = {
  invalidateModelCatalog: () => void
  loadProviderCredentials: (force?: boolean) => Promise<DesktopProviderCredential[]>
  mockClient: ProviderCredentialApi
  requireAgentCapability: (name: Extract<ProtocolCapability, 'provider.auth.pi.v1'>) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  setProviderCredentialsCache: (credentials: DesktopProviderCredential[] | null) => void
  providerState: (providerID: ModelProviderID) => Promise<DesktopModelProviderState>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentProviderCredentialApi({
  invalidateModelCatalog,
  loadProviderCredentials,
  mockClient,
  requireAgentCapability,
  rpc,
  setProviderCredentialsCache,
  providerState,
  withAgentOrMock,
}: Dependencies): ProviderCredentialApi {
  const invalidateCredentials = (invalidateCatalog = true): void => {
    setProviderCredentialsCache(null)
    if (invalidateCatalog) invalidateModelCatalog()
  }

  return {
    saveProviderApiKey: async (providerID, apiKey) => {
      await rpc.call('provider/apiKey/create', {
        providerId: providerID as RpcParams<'provider/apiKey/create'>['providerId'],
        label: '默认密钥',
        key: apiKey,
        operationId: crypto.randomUUID(),
      })
      invalidateCredentials()
      return providerState(providerID)
    },
    deleteProviderApiKey: async (providerID) => {
      const credentials = (await loadProviderCredentials(true)).filter(
        (credential) => credential.providerId === providerID && credential.kind === 'api-key',
      )
      if (credentials.length === 0) {
        throw new Error('当前 Provider 没有可删除的应用内 API 密钥。')
      }
      for (const credential of credentials) {
        await rpc.call('provider/credential/delete', {
          credentialId: credential.id,
          operationId: crypto.randomUUID(),
        })
      }
      invalidateCredentials()
      return providerState(providerID)
    },
    listProviderCredentials: (providerId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call(
            'provider/credential/list',
            providerId
              ? {
                  providerId: providerId as RpcParams<'provider/credential/list'>['providerId'],
                }
              : {},
          )
          if (!providerId) setProviderCredentialsCache([...result.credentials])
          return [...result.credentials]
        },
        () => mockClient.listProviderCredentials(providerId),
      ),
    readProviderCredentialStore: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('provider.auth.pi.v1')
          return rpc.call('provider/credential/store/read', {})
        },
        () => mockClient.readProviderCredentialStore(),
      ),
    updateProviderCredentialStore: (store) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('provider.auth.pi.v1')
          return rpc.call('provider/credential/store/update', {
            store,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.updateProviderCredentialStore(store),
      ),
    createApiKey: (input) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/apiKey/create', {
            ...input,
            providerId: input.providerId as RpcParams<'provider/apiKey/create'>['providerId'],
            operationId: crypto.randomUUID(),
          })
          invalidateCredentials()
          return result.credential
        },
        () => mockClient.createApiKey(input),
      ),
    updateApiKey: (input) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/apiKey/update', {
            ...input,
            credentialId: input.credentialId as RpcParams<'provider/apiKey/update'>['credentialId'],
            operationId: crypto.randomUUID(),
          })
          invalidateCredentials()
          return result.credential
        },
        () => mockClient.updateApiKey(input),
      ),
    setActiveProviderCredential: (providerId, credentialId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/credential/setActive', {
            providerId: providerId as RpcParams<'provider/credential/setActive'>['providerId'],
            credentialId:
              credentialId as RpcParams<'provider/credential/setActive'>['credentialId'],
            operationId: crypto.randomUUID(),
          })
          invalidateCredentials()
          return result.credential
        },
        () => mockClient.setActiveProviderCredential(providerId, credentialId),
      ),
    setProviderCredentialEnabled: (credentialId, enabled) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/credential/setEnabled', {
            credentialId:
              credentialId as RpcParams<'provider/credential/setEnabled'>['credentialId'],
            enabled,
            operationId: crypto.randomUUID(),
          })
          invalidateCredentials()
          return result.credential
        },
        () => mockClient.setProviderCredentialEnabled(credentialId, enabled),
      ),
    reorderApiKeys: (providerId, orderedCredentialIds) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/apiKey/reorder', {
            providerId: providerId as RpcParams<'provider/apiKey/reorder'>['providerId'],
            orderedCredentialIds:
              orderedCredentialIds as unknown as RpcParams<'provider/apiKey/reorder'>['orderedCredentialIds'],
            operationId: crypto.randomUUID(),
          })
          invalidateCredentials(false)
          return [...result.credentials]
        },
        () => mockClient.reorderApiKeys(providerId, orderedCredentialIds),
      ),
    testApiKey: (credentialId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/apiKey/test', {
            credentialId: credentialId as RpcParams<'provider/apiKey/test'>['credentialId'],
          })
          return {
            ok: result.ok,
            message: result.message,
          }
        },
        () => mockClient.testApiKey(credentialId),
      ),
    deleteProviderCredential: (credentialId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('provider/credential/delete', {
            credentialId: credentialId as RpcParams<'provider/credential/delete'>['credentialId'],
            operationId: crypto.randomUUID(),
          })
          invalidateCredentials()
          return [...result.credentials]
        },
        () => mockClient.deleteProviderCredential(credentialId),
      ),
  }
}
