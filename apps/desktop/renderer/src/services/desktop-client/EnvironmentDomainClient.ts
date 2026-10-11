import type { ManagedWorktree, RpcMethod, RpcParams, RpcResult } from '@pidex/agent-protocol'
import { createAgentRpcClient } from '../AgentRpcClient.js'
import { defaultDesktopClientEnvironment } from './Environment.js'

type Rpc = Pick<ReturnType<typeof createAgentRpcClient>, 'call' | 'ensureInitialized'>

export type EnvironmentDomainClient = ReturnType<typeof createEnvironmentDomainClient>

export function createEnvironmentDomainClient(rpc: Rpc) {
  return {
    startPrWatch: (params: RpcParams<'github/watch/start'>) =>
      rpc.call('github/watch/start', params),
    listPrWatches: () => rpc.call('github/watch/list', {}),
    updatePrWatch: (params: RpcParams<'github/watch/update'>) =>
      rpc.call('github/watch/update', params),
    stopPrWatch: (id: string) => rpc.call('github/watch/stop', { id }),
    generateGitMessage: (params: RpcParams<'git/message/generate'>) =>
      rpc.call('git/message/generate', params),
    async supportsThreadFork(): Promise<boolean> {
      try {
        const initialized = await rpc.ensureInitialized()
        return initialized.capabilities.includes('thread.fork.v1')
      } catch {
        return false
      }
    },
    readEnvironment: (threadId: string) => rpc.call('local-environment/read', { threadId }),
    async listProjectEnvironments(projectId: string) {
      const initialized = await rpc.ensureInitialized()
      if (!initialized.capabilities.includes('local-environment.multiple.v1'))
        throw new Error('当前 Agent 不支持多环境设置。请完整退出应用，并在更新 Agent 后重新启动。')
      return rpc.call('local-environment/project/list', { projectId })
    },
    readProjectEnvironment: (projectId: string, environmentId: string) =>
      rpc.call('local-environment/project/read', { projectId, environmentId }),
    createProjectEnvironment: (projectId: string, name: string) =>
      rpc.call('local-environment/project/create', { projectId, name }),
    updateProjectEnvironment: (params: RpcParams<'local-environment/project/update'>) =>
      rpc.call('local-environment/project/update', params),
    selectProjectEnvironment: (projectId: string, environmentId: string) =>
      rpc.call('local-environment/project/select', { projectId, environmentId }),
    deleteProjectEnvironment: (
      projectId: string,
      environmentId: string,
      expectedRevision: string,
    ) =>
      rpc.call('local-environment/project/delete', { projectId, environmentId, expectedRevision }),
    updateEnvironment: (params: RpcParams<'local-environment/update'>) =>
      rpc.call('local-environment/update', params),
    listActions: (threadId: string) => rpc.call('local-environment/action/list', { threadId }),
    listWorktrees: (projectId?: string) =>
      rpc.call('worktree/list', projectId ? { projectId } : {}),
    listWorktreeSettings: (projectId?: string) =>
      rpc.call('worktree/settings/list', projectId ? { projectId } : {}),
    deleteWorktreeFromSettings: (worktreeId: string, operationId: string) =>
      rpc.call('worktree/settings/delete', { worktreeId, operationId }),
    newChatInWorktree: (worktreeId: string) =>
      rpc.call('worktree/settings/new-chat', { worktreeId, operationId: crypto.randomUUID() }),
    createWorktree: (params: RpcParams<'worktree/create'>) => rpc.call('worktree/create', params),
    retryWorktreeSetup: (worktreeId: string, operationId: string = crypto.randomUUID()) =>
      rpc.call('worktree/retry-setup', { worktreeId, operationId }),
    continueWorktreeWithoutSetup: (worktreeId: string, operationId: string = crypto.randomUUID()) =>
      rpc.call('worktree/continue-without-setup', { worktreeId, operationId }),
    setWorktreePermanent: (
      worktreeId: string,
      permanent: boolean,
      operationId: string = crypto.randomUUID(),
    ) => rpc.call('worktree/set-permanent', { worktreeId, permanent, operationId }),
    deleteWorktree: (worktreeId: string, operationId: string = crypto.randomUUID()) =>
      rpc.call('worktree/delete', { worktreeId, operationId }),
    restoreWorktree: (worktreeId: string, operationId: string = crypto.randomUUID()) =>
      rpc.call('worktree/restore', { worktreeId, operationId }),
    worktreeOperationStatus: (operationId: string, afterOutputCursor?: number) =>
      rpc.call('worktree/operation/status', {
        operationId,
        ...(afterOutputCursor === undefined ? {} : { afterOutputCursor }),
      }),
    startHandoff: (params: RpcParams<'thread/handoff/start'>) =>
      rpc.call('thread/handoff/start', params),
    handoffStatus: (operationId: string, afterRevision?: number) =>
      rpc.call('thread/handoff/status', {
        operationId,
        ...(afterRevision === undefined ? {} : { afterRevision, waitMs: 30_000 }),
      }),
    pendingHandoff: (sourceThreadId: string) =>
      rpc.call('thread/handoff/pending', { sourceThreadId }),
    ackHandoff: (operationId: string, revision: number) =>
      rpc.call('thread/handoff/ack-client-transfer', { operationId, revision }),
    startThreadFork: (params: RpcParams<'thread/fork/start'>) =>
      rpc.call('thread/fork/start', params),
    threadForkStatus: (operationId: string, afterRevision?: number, afterOutputCursor?: number) =>
      rpc.call('thread/fork/status', {
        operationId,
        ...(afterRevision === undefined ? {} : { afterRevision }),
        ...(afterOutputCursor === undefined ? {} : { afterOutputCursor }),
        waitMs: 30_000,
      }),
    pendingThreadFork: (sourceThreadId: string, lastTurnId: string, sourceItemId: string) =>
      rpc.call('thread/fork/pending', {
        sourceThreadId,
        lastTurnId,
        sourceItemId,
      }),
    retryThreadForkSetup: (operationId: string, revision: number) =>
      rpc.call('thread/fork/retry-setup', { operationId, revision }),
    continueThreadForkWithoutSetup: (operationId: string, revision: number) =>
      rpc.call('thread/fork/continue-without-setup', { operationId, revision }),
    abandonThreadFork: (operationId: string, revision: number) =>
      rpc.call('thread/fork/abandon', { operationId, revision }),
    async projectForThread(threadId: string): Promise<string | null> {
      const result = await rpc.call('thread/list', { limit: 500 })
      const thread = result.threads.find((candidate) => candidate.id === threadId)
      return thread?.projectID ?? null
    },
  }
}

let singleton: EnvironmentDomainClient | null = null

export function environmentDomainClient(): EnvironmentDomainClient {
  if (singleton) return singleton
  const environment = defaultDesktopClientEnvironment()
  if (!environment.window?.DesktopBridge) {
    const call = (async (method: RpcMethod, params: unknown) =>
      (await import('./EnvironmentDomainMock.js')).browserEnvironmentCall(
        method,
        params as RpcParams<typeof method>,
      )) as Rpc['call']
    singleton = createEnvironmentDomainClient({
      call,
      ensureInitialized: async () => ({ capabilities: [] }) as never,
    })
    return singleton
  }
  const clientInstanceId = crypto.randomUUID()
  const rpc = createAgentRpcClient({
    ...environment,
    handshake: {
      initialize: {
        clientInfo: {
          name: 'pidex-environment-renderer',
          version: '0.2.0',
          platform: typeof navigator === 'undefined' ? 'desktop' : navigator.platform,
          instanceId: clientInstanceId,
        },
        protocols: ['thread-rpc-v4'],
        capabilities: [
          'rpc.typed.v1',
          'local-environment.manage.v1',
          'worktree.manage.v1',
          'worktree.settings.v1',
          'local-environment.multiple.v1',
          'github.watch.v1',
          'git.generate.v1',
          'thread.handoff.v1',
          'thread.fork.v1',
        ],
        interactionDelivery: 'observe',
      },
      initialized: { protocol: 'thread-rpc-v4', clientInstanceId },
    },
  })
  singleton = createEnvironmentDomainClient(rpc)
  return singleton
}

export type EnvironmentReadResult = RpcResult<'local-environment/read'>
export type WorktreeRecord = ManagedWorktree
