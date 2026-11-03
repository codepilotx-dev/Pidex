import type { ProtocolCapability } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'
import type { DesktopCalendarApi } from './Types.js'

type Dependencies = {
  mockClient: DesktopCalendarApi
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'calendar.manage.v1' | 'schedule.draft.v1'>,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  withAgentOrMock: <T>(agent: () => Promise<T>, mock: () => Promise<T>) => Promise<T>
}

export function createAgentCalendarApi({
  mockClient,
  requireAgentCapability,
  rpc,
  withAgentOrMock,
}: Dependencies): DesktopCalendarApi {
  const execute = <T>(operation: () => Promise<T>, mock: () => Promise<T>): Promise<T> =>
    withAgentOrMock(() => {
      requireAgentCapability('calendar.manage.v1')
      return operation()
    }, mock)
  // 任务规划草案有独立能力：缺失时确认整体失败，不退回创建普通自动化。
  const executeDraft = <T>(operation: () => Promise<T>, mock: () => Promise<T>): Promise<T> =>
    withAgentOrMock(() => {
      requireAgentCapability('schedule.draft.v1')
      return operation()
    }, mock)
  return {
    listCalendarOccurrences: (input) =>
      execute(
        () => rpc.call('calendar/range', input),
        () => mockClient.listCalendarOccurrences(input),
      ),
    readScheduledTask: (input) =>
      execute(
        () => rpc.call('scheduled-task/read', input),
        () => mockClient.readScheduledTask(input),
      ),
    createScheduledTask: (input) =>
      execute(
        () =>
          rpc.call('scheduled-task/create', {
            ...input,
            operationId: crypto.randomUUID(),
          }),
        () => mockClient.createScheduledTask(input),
      ),
    updateScheduledTask: (input) =>
      execute(
        () => rpc.call('scheduled-task/update', input),
        () => mockClient.updateScheduledTask(input),
      ),
    deleteScheduledTask: (input) =>
      execute(
        () => rpc.call('scheduled-task/delete', input),
        () => mockClient.deleteScheduledTask(input),
      ),
    runScheduledTask: (input) =>
      execute(
        () =>
          rpc.call('scheduled-task/run', {
            ...input,
            operationId: crypto.randomUUID(),
          }),
        () => mockClient.runScheduledTask(input),
      ),
    readSchedulePlan: (input) =>
      execute(
        () => rpc.call('schedule-plan/read', input),
        () => mockClient.readSchedulePlan(input),
      ),
    commitSchedulePlan: (input) =>
      execute(
        () =>
          rpc.call('schedule-plan/commit', {
            ...input,
            operationId: crypto.randomUUID(),
          }),
        () => mockClient.commitSchedulePlan(input),
      ),
    readScheduleDraft: (input) =>
      executeDraft(
        () => rpc.call('schedule-draft/read', input),
        () => mockClient.readScheduleDraft(input),
      ),
    commitScheduleDraft: (input) =>
      executeDraft(
        () =>
          rpc.call('schedule-draft/commit', {
            ...input,
            operationId: crypto.randomUUID(),
          }),
        () => mockClient.commitScheduleDraft(input),
      ),
    cancelScheduleDraft: (input) =>
      executeDraft(
        () => rpc.call('schedule-draft/cancel', input),
        () => mockClient.cancelScheduleDraft(input),
      ),
    feedbackScheduleDraft: (input) =>
      executeDraft(
        () =>
          rpc.call('schedule-draft/feedback', {
            ...input,
            operationId: crypto.randomUUID(),
          }),
        () => mockClient.feedbackScheduleDraft(input),
      ),
  }
}
