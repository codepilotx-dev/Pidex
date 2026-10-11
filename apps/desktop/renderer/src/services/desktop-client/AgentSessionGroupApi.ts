import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopSessionGroupApi } from './Types.js'

type Rpc = Pick<ReturnType<typeof createAgentRpcClient>, 'call'>

type Dependencies = {
  requireAgentCapability: (name: ProtocolCapability) => void
  rpc: Rpc
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createAgentSessionGroupApi({
  requireAgentCapability,
  rpc,
  withRequiredAgent,
}: Dependencies): DesktopSessionGroupApi {
  const execute = <T>(operation: () => Promise<T>): Promise<T> =>
    withRequiredAgent(async () => {
      requireAgentCapability('workflow.v1')
      return operation()
    })

  return {
    listSessionGroups: () =>
      execute(async () => [...(await rpc.call('workflow/list', {})).workflows]),
    readSessionGroup: (groupId) =>
      execute(async () => {
        const [value, context] = await Promise.all([
          rpc.call('workflow/read', { workflowId: groupId }),
          rpc.call('workflow/context/read', { workflowId: groupId }),
        ])
        return {
          group: value.workflow,
          members: value.memberships.map(({ workflowId, ...membership }) => ({
            ...membership,
            groupId: workflowId,
          })),
          digest: context.state.digest,
          contextEntries: context.entries.map(({ workflowId, ...entry }) => ({
            ...entry,
            groupId: workflowId,
          })),
        }
      }),
    createSessionGroup: (input) =>
      execute(
        async () =>
          (
            await rpc.call('workflow/create', {
              ...input,
              operationId: crypto.randomUUID(),
            })
          ).workflow,
      ),
    updateSessionGroup: ({ groupId, version, name, description }) =>
      execute(
        async () =>
          (
            await rpc.call('workflow/update', {
              workflowId: groupId,
              expectedVersion: version ?? 1,
              patch: {
                ...(name !== undefined ? { name } : {}),
                ...(description !== undefined ? { description } : {}),
              },
              operationId: crypto.randomUUID(),
            })
          ).workflow,
      ),
    deleteSessionGroup: (groupId, expectedVersion) =>
      execute(async () => {
        await rpc.call('workflow/delete', {
          workflowId: groupId,
          expectedVersion,
          operationId: crypto.randomUUID(),
        })
      }),
    setSessionGroupMembership: (input) =>
      execute(async () => {
        await rpc.call('workflow/membership/set', {
          threadId: input.threadId,
          workflowId: input.groupId,
          operationId: crypto.randomUUID(),
        })
      }),
    listSessionGroupSteps: (groupId) =>
      execute(async () => [
        ...(await rpc.call('workflow/step/list', { workflowId: groupId })).steps.map(
          ({ workflowId, ...step }) => ({ ...step, groupId: workflowId }),
        ),
      ]),
    readSessionGroupStepDiff: (input) =>
      execute(() =>
        rpc.call('workflow/step/diff', {
          workflowId: input.groupId,
          stepId: input.stepId,
          ...(input.path ? { path: input.path } : {}),
        }),
      ),
  }
}
