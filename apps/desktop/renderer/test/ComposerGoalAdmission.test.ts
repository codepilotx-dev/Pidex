import { describe, expect, test } from 'bun:test'
import type { ThreadSnapshot } from '@pidex/shared/thread'
import { createAgentTurnQueueClient } from '../src/services/desktop-client/AgentTurnQueueClient.js'

function harness(status?: string, interruptGate?: Promise<void>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  let imported = false
  let failed = false
  let failNext = false
  const client = createAgentTurnQueueClient({
    rpc: {
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params })
        if (method === 'turn/interrupt') await interruptGate
        if (failNext && !failed) {
          failed = true
          throw new Error('目标版本冲突')
        }
        return {}
      },
    } as unknown as Parameters<typeof createAgentTurnQueueClient>[0]['rpc'],
    awaitPendingSettingsUpdate: async () => {
      calls.push({ method: 'settings/synced', params: {} })
    },
    importMessageContext: async () => {
      imported = true
      return { attachmentIds: ['attachment:1'], contextReferenceIds: ['context:1'] }
    },
    resolveModelRef: async () => ({ providerID: 'openai', modelID: 'gpt-test' }),
    permissionConfigForSession: () => ({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    }),
    taskModeForSession: () => 'chat',
    queueVersionForSession: () => 1,
    loadThreadSnapshot: async () =>
      ({ turns: status ? [{ id: 'turn:active', status }] : [] }) as unknown as ThreadSnapshot,
    refreshSession: async () => ({}) as never,
    emitSessionStoreChange: () => {},
  })
  return {
    client,
    calls,
    imported: () => imported,
    failNext: () => {
      failNext = true
    },
  }
}

describe('goal and first-turn admission', () => {
  test('start, steering and queued messages keep authored brackets and send attachments separately', async () => {
    for (const delivery of ['start', 'steer', 'follow-up'] as const) {
      const { client, calls } = harness('running')
      const input = {
        text: '保留 [image.png] 和 [用户原文]',
        attachments: [
          { id: 'image', name: 'image.png', kind: 'image' as const, status: 'ready' as const },
        ],
        skills: [{ name: 'review', path: 'skills/review' }],
      }
      await client.submitMessage('thread:1', input, delivery)
      const request = calls.find((call) =>
        ['turn/start', 'turn/steer', 'queue/add'].includes(call.method),
      )
      expect(request?.params).toMatchObject({
        content: input.text,
        attachmentIds: ['attachment:1'],
        skills: input.skills,
      })
    }
  })
  test('显式 Plan 覆盖尚未更新的 Chat 设置，活动 Chat 不接受 Plan steer', async () => {
    const { client, calls } = harness()
    await client.submitMessage('thread', { text: '规划', taskMode: 'plan' }, 'start')
    expect(calls.find((call) => call.method === 'turn/start')?.params.taskMode).toBe('plan')
    const active = harness('running')
    await expect(
      active.client.submitMessage('thread', { text: '规划', taskMode: 'plan' }, 'steer'),
    ).rejects.toThrow('等待结束')
    expect(active.calls.some((call) => call.method === 'turn/steer')).toBe(false)
  })
  test('目标与技能、附件、引用、模型和同一提交身份一起进入 turn/start', async () => {
    const { client, calls, failNext } = harness()
    const input = { text: '完成修复', skills: [{ name: 'repair', path: 'skills/repair' }] }
    const options = { inputId: 'draft:retry', goal: { objective: '完成修复', expectedVersion: 2 } }
    failNext()
    await expect(client.submitMessage('thread:1', input, 'start', options)).rejects.toThrow(
      '目标版本冲突',
    )
    await client.submitMessage('thread:1', input, 'start', options)
    expect(calls[0]?.method).toBe('settings/synced')
    const starts = calls.filter((call) => call.method === 'turn/start')
    expect(starts).toHaveLength(2)
    expect(starts[0]?.params).toEqual(starts[1]?.params)
    expect(starts[1]?.params).toMatchObject({
      inputId: 'draft:retry',
      content: '完成修复',
      skills: input.skills,
      goal: options.goal,
      attachmentIds: ['attachment:1'],
      contextReferenceIds: ['context:1'],
      model: { modelID: 'gpt-test' },
      taskMode: 'chat',
    })
    expect(calls.some((call) => call.method === 'thread/goal/set')).toBeFalse()
  })
  test.each(['queued', 'running', 'waiting-question'])(
    '运行状态 %s 保留提交，不导入附件也不丢入队列',
    async (status) => {
      const h = harness(status)
      await expect(
        h.client.submitMessage('thread:1', { text: '新目标' }, 'start', {
          goal: { objective: '新目标', expectedVersion: null },
        }),
      ).rejects.toThrow('等待本轮结束')
      expect(h.imported()).toBeFalse()
      expect(h.calls.map((call) => call.method)).toEqual(['settings/synced'])
    },
  )
  test('重复停止共享同一个进行中请求', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = harness('running', gate)
    const first = h.client.interrupt('thread:1')
    const second = h.client.interrupt('thread:1')

    release()
    await Promise.all([first, second])

    expect(h.calls.filter((call) => call.method === 'turn/interrupt')).toHaveLength(1)
  })
})
