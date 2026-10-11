import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopAutomationApi } from './Types.js'

type Dependencies = {
  requireAgentCapability: (name: Extract<ProtocolCapability, 'automation.manage.v1'>) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createAgentAutomationApi({
  requireAgentCapability,
  rpc,
  withRequiredAgent,
}: Dependencies): DesktopAutomationApi {
  const execute = <T>(operation: () => Promise<T>): Promise<T> =>
    withRequiredAgent(() => {
      requireAgentCapability('automation.manage.v1')
      return operation()
    })
  return {
    listAutomations: (input) => execute(() => rpc.call('automation/list', input)),
    readAutomation: (input) => execute(() => rpc.call('automation/read', input)),
    createAutomation: (input) =>
      execute(() =>
        rpc.call('automation/create', {
          ...input,
          operationId: crypto.randomUUID(),
        }),
      ),
    updateAutomation: (input) =>
      execute(() =>
        rpc.call('automation/update', {
          automationId: input.automationId,
          expectedRevision: input.expectedRevision,
          ...input.patch,
        }),
      ),
    deleteAutomation: (input) => execute(() => rpc.call('automation/delete', input)),
    runAutomation: (input) =>
      execute(() =>
        rpc.call('automation/run', {
          ...input,
          operationId: crypto.randomUUID(),
        }),
      ),
    listAutomationRuns: (input) => execute(() => rpc.call('automation/run/list', input)),
    markAutomationRunRead: (input) => execute(() => rpc.call('automation/run/mark-read', input)),
    markAllAutomationRunsRead: (input) =>
      execute(() => rpc.call('automation/run/mark-all-read', input)),
    previewAutomationSchedule: async (input) =>
      (await execute(() => rpc.call('automation/schedule/preview', input))).preview,
  }
}
