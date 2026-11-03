import { AgentRpcError } from '../src/services/AgentRpcClient.js'
import { expect, test } from 'bun:test'
import type { ThreadSnapshot } from '@pidex/shared/thread'
import { createAgentTurnQueueClient } from '../src/services/desktop-client/AgentTurnQueueClient.js'

test('Goal 队列冻结附件和设置，不携带旧目标版本且不调用目标设置 RPC', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  type Dependencies = Parameters<typeof createAgentTurnQueueClient>[0]
  const model = { providerID: 'openai', id: 'test-model' }
  const permissions = {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  }
  const frozenPermissions = { ...permissions }
  const snapshot = {
    turns: [{ status: 'running' }],
    goal: { version: 7 },
  } as unknown as ThreadSnapshot
  let supported = true
  const dependencies = {
    rpc: {
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params })
        return { admission: 'queued' }
      },
    },
    awaitPendingSettingsUpdate: async () => {},
    importMessageContext: async () => {
      permissions.sandboxMode = 'read-only'
      return { attachmentIds: ['image-1'], contextReferenceIds: ['reference-1'] }
    },
    resolveModelRef: async () => model,
    permissionConfigForSession: () => permissions,
    taskModeForSession: () => 'chat',
    queueVersionForSession: () => 3,
    loadThreadSnapshot: async () => snapshot,
    refreshSession: async () => ({}),
    emitSessionStoreChange: () => {},
    supportsGoalQueue: () => supported,
  } as unknown as Dependencies
  const client = createAgentTurnQueueClient(dependencies)
  expect(
    await client.submitMessage(
      'thread',
      { text: '新目标', taskMode: 'chat', goal: { objective: '新目标' } },
      'steer',
      { inputId: 'input' },
    ),
  ).toEqual({ inputId: 'input', outcome: 'queued' })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    method: 'queue/add',
    params: {
      goal: { objective: '新目标' },
      model,
      permissionConfig: frozenPermissions,
      taskMode: 'chat',
      attachmentIds: ['image-1'],
      contextReferenceIds: ['reference-1'],
    },
  })
  expect(calls[0]!.params.goal).not.toHaveProperty('expectedVersion')
  supported = false
  await expect(
    client.submitMessage(
      'thread',
      { text: '不能静默退化', taskMode: 'chat', goal: { objective: '目标' } },
      'follow-up',
    ),
  ).rejects.toThrow('不支持目标排队')
  expect(calls).toHaveLength(1)
  snapshot.turns = []
  await client.submitMessage(
    'thread',
    { text: '旧 Agent 空闲目标', taskMode: 'chat', goal: { objective: '目标' } },
    'follow-up',
  )
  expect(calls[1]).toMatchObject({
    method: 'turn/start',
    params: { goal: { objective: '目标', expectedVersion: 7 } },
  })
})

test('队列操作读取最新版本并仅重试一次版本冲突，保留操作身份', async () => {
  type Dependencies = Parameters<typeof createAgentTurnQueueClient>[0]
  for (const method of ['queue/add', 'queue/update', 'queue/remove', 'queue/resume'] as const) {
    const requests: Array<Record<string, unknown>> = []
    let version = 13
    let refreshed = 0
    const client = createAgentTurnQueueClient({
      rpc: {
        call: async (_method: string, params: Record<string, unknown>) => {
          requests.push(params)
          if (requests.length === 1) {
            version = 14
            throw new AgentRpcError('队列版本已变化，请刷新后重试', -32603, {
              code: 'CONFLICT',
              retryable: false,
              details: { expectedVersion: 13, actualVersion: 14 },
            })
          }
          return { admission: 'queued' }
        },
      },
      queueVersionForSession: () => 11,
      loadThreadSnapshot: async () => ({ queue: { version } }),
      refreshSession: async () => {
        refreshed++
        return {}
      },
      emitSessionStoreChange: () => {},
    } as unknown as Dependencies)
    const mutate =
      method === 'queue/add'
        ? () => client.callQueueMutation('thread', method, { inputId: 'input' })
        : () => client.callQueueMutation('thread', method, { inputId: 'input' })
    await mutate()
    expect(requests.map((request) => request.expectedVersion)).toEqual([13, 14])
    expect(requests[0]?.operationId).toBe(requests[1]?.operationId)
    expect(requests[1]?.inputId).toBe('input')
    expect(refreshed).toBe(1)
  }
})

test('持续版本冲突只尝试两次，刷新并提供重试提示', async () => {
  type Dependencies = Parameters<typeof createAgentTurnQueueClient>[0]
  let calls = 0
  let refreshed = 0
  const client = createAgentTurnQueueClient({
    rpc: {
      call: async () => {
        calls++
        throw new AgentRpcError('队列版本已变化', -32603, {
          code: 'CONFLICT',
          retryable: false,
          details: { expectedVersion: 1, actualVersion: 2 },
        })
      },
    },
    loadThreadSnapshot: async () => ({ queue: { version: 1 } }),
    refreshSession: async () => {
      refreshed++
      return {}
    },
    emitSessionStoreChange: () => {},
  } as unknown as Dependencies)
  await expect(
    client.callQueueMutation('thread', 'queue/remove', { inputId: 'input' }),
  ).rejects.toMatchObject({
    code: 'QUEUE_VERSION_CONFLICT',
    message: '队列仍在变化，已刷新最新状态，请重试。',
  })
  expect(calls).toBe(2)
  expect(refreshed).toBe(2)
})

test('队列冲突后不覆盖其他窗口刚编辑的同一输入', async () => {
  type Dependencies = Parameters<typeof createAgentTurnQueueClient>[0]
  let writes = 0
  let content = '原正文'
  const client = createAgentTurnQueueClient({
    rpc: {
      call: async () => {
        writes++
        content = '其他窗口的新正文'
        throw new AgentRpcError('队列版本已变化', -32603, {
          code: 'CONFLICT',
          retryable: false,
          details: { expectedVersion: 1, actualVersion: 2 },
        })
      },
    },
    loadThreadSnapshot: async () => ({
      queue: { version: writes ? 2 : 1 },
      inputs: [{ id: 'input', content }],
    }),
    refreshSession: async () => ({}),
    emitSessionStoreChange: () => {},
  } as unknown as Dependencies)
  await expect(
    client.callQueueMutation('thread', 'queue/update', { inputId: 'input', content: '本窗口编辑' }),
  ).rejects.toMatchObject({ code: 'QUEUE_VERSION_CONFLICT' })
  expect(writes).toBe(1)
})
