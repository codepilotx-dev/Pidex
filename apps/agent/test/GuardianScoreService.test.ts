import { describe, expect, test } from 'bun:test'
import type { AgentDatabase } from '../src/storage/database/AgentDatabase'
import type { ToolInvocation } from '../src/Domain'
import type { ReviewerService } from '../src/permission/ReviewerService'
import { GuardianScoreService } from '../src/permission/GuardianScoreService'
import type { GuardianClassification } from '../src/permission/Guardian'

const invocation = (overrides: Record<string, unknown> = {}): ToolInvocation =>
  ({
    id: 'tool-1',
    threadID: 'thread-1',
    turnID: 'turn-1',
    agentID: 'agent-1',
    name: 'Bash',
    input: { command: 'git status' },
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

const reviewer = (
  classify: (
    value: ToolInvocation,
  ) => GuardianClassification | Promise<GuardianClassification> = async () => ({
    risk: 'low',
    reason: 'test',
  }),
) =>
  ({
    classify: async (value: ToolInvocation) => classify(value),
  }) as unknown as ReviewerService

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const deferred = () => {
  let resolve!: (value: GuardianClassification) => void
  const promise = new Promise<GuardianClassification>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const benign = { risk: 'low' as const, reason: 'benign' }

describe('GuardianScoreService', () => {
  test('a current low-risk score satisfies the approval without a synchronous review', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), reviewer())
    const value = invocation()
    service.observe(value)
    const decision = await service.waitForLowRisk(value, new AbortController().signal, 1_000)
    expect(decision).toMatchObject({
      decision: 'allow',
      guardian: { status: 'cached', source: 'cache', risk: 'low' },
    })
    const cancelled = new AbortController()
    cancelled.abort()
    expect(service.cachedAllow(value, cancelled.signal)).toBeNull()
    expect(service.cachedAllow(value)).not.toBeNull()
  })

  test('high-risk and failed scores never satisfy the fast path', async () => {
    const high = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(async () => ({ risk: 'high', reason: 'test' })),
    )
    const value = invocation()
    high.observe(value)
    expect(await high.waitForLowRisk(value, new AbortController().signal, 1_000)).toBeNull()

    const failed = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(async () => {
        throw new Error('reviewer unavailable')
      }),
    )
    failed.observe(value)
    expect(await failed.waitForLowRisk(value, new AbortController().signal, 1_000)).toBeNull()
  })

  test('sensitive actions are never scored or auto-approved', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), reviewer())
    const value = invocation({ input: { command: 'npm test' } })
    service.observe(value)
    await tick()
    expect(service.cachedAllow(value)).toBeNull()
    expect(await service.waitForLowRisk(value, new AbortController().signal, 100)).toBeNull()
  })

  test('a user-authorization change invalidates the score', async () => {
    const state = { count: 1 }
    const service = new GuardianScoreService(database(state), reviewer())
    const value = invocation()
    service.observe(value)
    await tick()
    state.count = 2
    expect(await service.waitForLowRisk(value, new AbortController().signal, 1_000)).toBeNull()
    expect(service.cachedAllow(value)).toBeNull()
  })

  test('a low trajectory score may cover the next pending action in the same class', async () => {
    const gate = deferred()
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer((value) =>
        value.input.command === 'git status'
          ? { risk: 'low', trajectory_risk: 'low', predicted_risk: 'low', reason: 'benign' }
          : gate.promise,
      ),
    )
    const first = invocation()
    service.observe(first)
    await service.waitForLowRisk(first, new AbortController().signal, 1_000)
    service.recordDecision(first, 'allow')
    const second = { ...first, id: 'tool-2', input: { command: 'git diff' } }
    service.observe(second)
    expect(service.cachedAllow(second)).toMatchObject({
      decision: 'allow',
      reason: 'Guardian 低风险轨迹快速通道放行（异步评分复用）',
    })
    gate.resolve(benign)
  })

  test('scores never cross into a sensitive or different capability class', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), reviewer())
    const first = invocation()
    service.observe(first)
    await service.waitForLowRisk(first, new AbortController().signal, 1_000)
    service.recordDecision(first, 'allow')
    const write = invocation({
      id: 'tool-write',
      name: 'Write',
      input: { file_path: 'src/a.ts' },
      toolPolicy: {
        capabilities: { filesystem: 'workspace-write', network: 'none', process: false },
      },
    })
    service.observe(write)
    await tick()
    expect(service.cachedAllow(write)).toBeNull()
    const network = invocation({
      id: 'tool-network',
      name: 'WebSearch',
      input: { query: 'x' },
      toolPolicy: {
        capabilities: { filesystem: 'none', network: 'read', process: false },
      },
    })
    service.observe(network)
    await tick()
    expect(service.cachedAllow(network)).toBeNull()
  })

  test('a denial invalidates every reuse candidate in the turn', async () => {
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(async () => ({
        risk: 'low',
        trajectory_risk: 'low',
        predicted_risk: 'low',
        reason: 'benign',
      })),
    )
    const first = invocation()
    service.observe(first)
    const second = { ...first, id: 'tool-2', input: { command: 'git diff' } }
    service.observe(second)
    await service.waitForLowRisk(second, new AbortController().signal, 1_000)
    service.recordDecision(first, 'deny')
    expect(service.cachedAllow(second)).toBeNull()
  })

  test('a late low score after a deny/ask invalidation cannot resurrect an approval', async () => {
    const gate = deferred()
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(() => gate.promise),
    )
    const value = invocation()
    service.observe(value)
    service.recordDecision(invocation({ id: 'other-tool' }), 'ask')
    gate.resolve(benign)
    await tick()
    expect(service.cachedAllow(value)).toBeNull()
    expect(await service.waitForLowRisk(value, new AbortController().signal, 100)).toBeNull()
  })

  test('a late low score resolves after an explicit invalidation action', async () => {
    const gate = deferred()
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(() => gate.promise),
    )
    const value = invocation()
    service.observe(value)
    service.invalidateAction(value)
    gate.resolve(benign)
    await tick()
    expect(service.cachedAllow(value)).toBeNull()
  })

  test('a late low score after turn end is unusable', async () => {
    const gate = deferred()
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(() => gate.promise),
    )
    const value = invocation()
    service.observe(value)
    service.endTurn('thread-1', 'turn-1')
    gate.resolve(benign)
    await tick()
    expect(service.cachedAllow(value)).toBeNull()
    expect(await service.waitForLowRisk(value, new AbortController().signal, 100)).toBeNull()
  })

  test('a late low score after an authorization change is unusable', async () => {
    const state = { count: 1 }
    const gate = deferred()
    const service = new GuardianScoreService(
      database(state),
      reviewer(() => gate.promise),
    )
    const value = invocation()
    service.observe(value)
    state.count = 2
    gate.resolve(benign)
    await tick()
    expect(service.cachedAllow(value)).toBeNull()
  })

  test('a late low score after cancellation is unusable', async () => {
    const gate = deferred()
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer(() => gate.promise),
    )
    const value = invocation()
    service.observe(value)
    const controller = new AbortController()
    const waiting = service.waitForLowRisk(value, controller.signal, 1_000)
    controller.abort()
    expect(await waiting).toBeNull()
    gate.resolve(benign)
    await tick()
    expect(service.cachedAllow(value)).toBeNull()
  })

  test('the same tool call id with a changed command never reuses its old score', async () => {
    const gate = deferred()
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer((value) =>
        value.input.command === 'git status'
          ? { risk: 'low', trajectory_risk: 'low', predicted_risk: 'low', reason: 'benign' }
          : gate.promise,
      ),
    )
    const first = invocation()
    service.observe(first)
    await service.waitForLowRisk(first, new AbortController().signal, 1_000)
    service.recordDecision(first, 'allow')

    const changed = invocation({ input: { command: 'git diff' } })
    service.observe(changed)
    expect(service.cachedAllow(changed)).toBeNull()
    gate.resolve({ risk: 'high', reason: 'changed command is risky' })
    await tick()
    expect(service.cachedAllow(changed)).toBeNull()
  })

  test('a settled high score for the current action blocks older low reuse', async () => {
    const service = new GuardianScoreService(
      database({ count: 1 }),
      reviewer((value) =>
        value.input.command === 'git status'
          ? { risk: 'low', trajectory_risk: 'low', predicted_risk: 'low', reason: 'benign' }
          : { risk: 'high', reason: 'not benign' },
      ),
    )
    const first = invocation()
    service.observe(first)
    await service.waitForLowRisk(first, new AbortController().signal, 1_000)
    service.recordDecision(first, 'allow')
    const second = { ...first, id: 'tool-2', input: { command: 'git diff' } }
    service.observe(second)
    await tick()
    expect(service.cachedAllow(second)).toBeNull()
    expect(await service.waitForLowRisk(second, new AbortController().signal, 100)).toBeNull()
  })

  test('endTurn only affects the matching turn and clearThread drops state', async () => {
    const service = new GuardianScoreService(database({ count: 1 }), reviewer())
    const value = invocation()
    service.observe(value)
    service.endTurn('thread-1', 'other-turn')
    expect(await service.waitForLowRisk(value, new AbortController().signal, 1_000)).toMatchObject({
      decision: 'allow',
    })
    service.clearThread('thread-1')
    expect(service.cachedAllow(value)).toBeNull()
  })
})
