import { describe, expect, test } from 'bun:test'
import type { AgentDatabase } from '../src/storage/database/AgentDatabase'
import type { ToolInvocation } from '../src/Domain'
import type { ReviewerService } from '../src/permission/ReviewerService'
import { GuardianScoreService } from '../src/permission/GuardianScoreService'

const invocation = (overrides: Record<string, unknown> = {}): ToolInvocation =>
  ({
    id: 'tool-1',
    threadID: 'thread-1',
    turnID: 'turn-1',
    agentID: 'agent-1',
    name: 'Bash',
    input: { command: 'npm test' },
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    },
    taskMode: 'chat',
    toolPolicy: {
      capabilities: { filesystem: 'none', network: 'none', process: true },
    },
    ...overrides,
  }) as unknown as ToolInvocation

const database = (state: { count: number }) =>
  ({
    sqlite: {
      query: () => ({
        all: () => [{ id: 'message-1' }],
        get: () => ({ count: state.count }),
      }),
    },
  }) as unknown as AgentDatabase

describe('GuardianScoreService', () => {
  test('a current low-risk score satisfies the approval without a synchronous review', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), {
      classify: async () => ({ risk: 'low', reason: 'test' }),
    } as unknown as ReviewerService)
    const value = invocation()
    service.observe(value)
    const decision = await service.waitForLowRisk(value, new AbortController().signal, 1_000)
    expect(decision).toMatchObject({
      decision: 'allow',
      guardian: { status: 'cached', source: 'cache', risk: 'low' },
    })
  })

  test('high-risk and failed scores never satisfy the fast path', async () => {
    const high = new GuardianScoreService(database({ count: 1 }), {
      classify: async () => ({ risk: 'high', reason: 'test' }),
    } as unknown as ReviewerService)
    const value = invocation()
    high.observe(value)
    expect(await high.waitForLowRisk(value, new AbortController().signal, 1_000)).toBeNull()

    const failed = new GuardianScoreService(database({ count: 1 }), {
      classify: async () => {
        throw new Error('reviewer unavailable')
      },
    } as unknown as ReviewerService)
    failed.observe(value)
    expect(await failed.waitForLowRisk(value, new AbortController().signal, 1_000)).toBeNull()
  })

  test('a user-authorization change invalidates the score', async () => {
    const state = { count: 1 }
    const service = new GuardianScoreService(database(state), {
      classify: async () => ({ risk: 'low', reason: 'test' }),
    } as unknown as ReviewerService)
    const value = invocation()
    service.observe(value)
    state.count = 2
    expect(await service.waitForLowRisk(value, new AbortController().signal, 1_000)).toBeNull()
  })

  test('a low trajectory score may cover the next action in the same class', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), {
      classify: async (value: ToolInvocation) => ({
        risk: value.id === 'tool-1' ? 'low' : 'high',
        trajectory_risk: 'low',
        predicted_risk: 'low',
        reason: 'benign',
      }),
    } as unknown as ReviewerService)
    const first = invocation({ input: { command: 'git status' } })
    service.observe(first)
    await service.waitForLowRisk(first, new AbortController().signal, 1_000)
    service.recordDecision(first, 'allow')
    const second = { ...first, id: 'tool-2', input: { command: 'git diff' } }
    service.observe(second)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(service.cachedAllow(second)).toMatchObject({
      decision: 'allow',
      reason: 'Guardian 低风险轨迹快速通道放行（异步评分复用）',
    })
  })

  test('scores never cross into a sensitive or different capability class', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), {
      classify: async (value: ToolInvocation) => ({
        risk: value.name === 'Bash' ? 'low' : 'high',
        trajectory_risk: 'low',
        predicted_risk: 'low',
        reason: 'benign',
      }),
    } as unknown as ReviewerService)
    const first = invocation()
    service.observe(first)
    await service.waitForLowRisk(first, new AbortController().signal, 1_000)
    service.recordDecision(first, 'allow')
    const write = {
      ...first,
      id: 'tool-write',
      name: 'Write',
      input: { file_path: 'src/a.ts' },
      toolPolicy: {
        capabilities: { filesystem: 'workspace-write', network: 'none', process: false },
      },
    } as unknown as ToolInvocation
    service.observe(write)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(service.cachedAllow(write)).toBeNull()
  })

  test('a denial invalidates every reuse candidate in the turn', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), {
      classify: async () => ({
        risk: 'low',
        trajectory_risk: 'low',
        predicted_risk: 'low',
        reason: 'benign',
      }),
    } as unknown as ReviewerService)
    const first = invocation()
    service.observe(first)
    const second = { ...first, id: 'tool-2', input: { command: 'npm run build' } }
    service.observe(second)
    await service.waitForLowRisk(second, new AbortController().signal, 1_000)
    service.recordDecision(first, 'deny')
    expect(service.cachedAllow(second)).toBeNull()
  })
})
