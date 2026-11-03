import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import { Model, Provider } from '@pidex/model-schema'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { ThreadService } from '../src/session/ThreadService'
import type { AgentRuntimeRequest } from '../src/orchestration/AgentRuntimeTypes'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import {
  GoalContinuationCoordinator,
  type GoalVerifierRunner,
} from '../src/orchestration/GoalContinuationCoordinator'
import { AgentRuntimeService } from '../src/orchestration/AgentRuntimeService'
import { executeHarnessRun } from '../src/orchestration/pi/ExecuteHarnessRun'
import type {
  GoalBudgetLifecycle,
  HarnessRuntimeOptions,
  HarnessRuntimeRequest,
} from '../src/orchestration/pi/Types'
import { GoalBudgetLimitError } from '../src/session/GoalDirectiveService'
import { runGoalVerifier, type GoalVerifierOutcome } from '../src/session/GoalVerifier'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'
import { InMemorySessionRepo } from '../scripts/support/PiSessionMemory'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { removeFixturePaths } from './FixtureCleanup'
import { QueuedGoalRepository } from '../src/storage/repositories/QueuedGoalRepository'

const fixtures: Array<{ db: AgentDatabase; root: string }> = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close()
    await removeFixturePaths([fixture.root])
  }
}, 30_000)
const submit = {
  content: '推进目标',
  model: Model.Ref.make({ providerID: Provider.ID.make('faux'), id: Model.ID.make('test') }),
  permissionConfig: DEFAULT_PERMISSION_CONFIG,
  strategy: 'queue',
  taskMode: 'chat',
} as const
const pass: GoalVerifierOutcome = {
  kind: 'verdict',
  verdict: { passed: true, reason: '交付证据齐全', nextAction: '' },
}
const fail: GoalVerifierOutcome = {
  kind: 'verdict',
  verdict: { passed: false, reason: '缺测试', nextAction: '运行核心测试 <core>' },
}
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const bounded = async <T>(promise: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('integration callback did not run')), 3000)
    }),
  ]).finally(() => clearTimeout(timer))
}
const fixture = async (tokenBudget: number | null = null) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-integration-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  fixtures.push({ db, root })
  const hub = await Effect.runPromise(EventHub.make)
  const service = new ThreadGoalService(db, hub)
  const thread = db.createThread('Goal integration')
  const goal = (
    await service.set({
      threadId: thread.id,
      objective: '交付完整实现并验证',
      tokenBudget,
      expectedVersion: null,
      operationId: 'create',
    })
  ).goal
  return { db, root, hub, service, thread, goal }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const finish = (f: Fixture, text = '尚有工作', tool?: Record<string, unknown>) => {
  const turn = f.db.createTurn(f.thread.id, submit)
  f.db.claimTurnExecution(turn.turnID)
  f.db.upsertItem(f.thread.id, {
    id: crypto.randomUUID(),
    turnID: turn.turnID,
    agentID: turn.agentID,
    type: 'text',
    status: 'completed',
    data: { text, placement: 'result' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  if (tool)
    f.db.upsertItem(f.thread.id, {
      id: crypto.randomUUID(),
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'tool',
      status: 'completed',
      data: tool,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  f.db.finalizeTurn({
    threadID: f.thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    status: 'completed',
  })
  return turn
}
const queued = (f: Fixture) =>
  (
    f.db.sqlite
      .query("SELECT COUNT(*) AS n FROM turns WHERE thread_id = ? AND status = 'queued'")
      .get(f.thread.id) as { n: number }
  ).n
const coordinator = (f: Fixture, verify: GoalVerifierRunner) =>
  new GoalContinuationCoordinator({
    db: f.db,
    hub: f.hub,
    verify,
    publish: async (events) => {
      for (const event of events) await Effect.runPromise(f.hub.publish(event))
    },
  })
const provider = () => {
  const faux = fauxProvider({ models: [{ id: 'test', input: ['text'], contextWindow: 64000 }] })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models, model: faux.getModel() }
}
const liveVerifier =
  (
    models: ReturnType<typeof provider>['models'],
    model: ReturnType<typeof provider>['model'],
  ): GoalVerifierRunner =>
  ({ goal, evidence, currentState, signal, admit, onResponse }) =>
    runGoalVerifier({ goal, evidence, currentState }, { models, model, signal, admit, onResponse })
const lifecycle = (f: Fixture) => {
  const runtime = new AgentRuntimeService({ db: f.db, hub: f.hub } as never)
  return (
    runtime as unknown as { goalBudgetLifecycle(): GoalBudgetLifecycle }
  ).goalBudgetLifecycle()
}
const harness = async (
  f: Fixture,
  setup: ReturnType<typeof provider>,
  budget = lifecycle(f),
  session?: Awaited<ReturnType<InMemorySessionRepo['create']>>,
) => {
  const turn = f.db.createTurn(f.thread.id, submit)
  const request: HarnessRuntimeRequest = {
    threadID: f.thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    sessionID: 'integration',
    content: '执行目标',
    taskMode: 'chat',
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    signal: new AbortController().signal,
    workspace: {} as never,
    model: setup.model,
    policyModel: submit.model,
    exposedTools: ['update_plan'],
    promptSections: [],
  }
  const runtime: HarnessRuntimeOptions = {
    harnessFactory: {
      resolve: async () => ({
        models: setup.models,
        session: session ?? (await new InMemorySessionRepo().create({ id: crypto.randomUUID() })),
      }),
    } as never,
    toolExecutor: new ToolExecutor(new ToolRegistry()),
    eventSink: {},
    lifecycle: { updatePlan: async () => ({}) },
    goalBudget: budget,
  }
  return { run: () => executeHarnessRun(runtime, request), request, runtime, turn }
}

const threadService = async (
  f: Fixture,
  setup: ReturnType<typeof provider>,
  run: (request: AgentRuntimeRequest) => Promise<{ status: 'completed'; output: string }>,
) => {
  const workspace = await WorkspaceService.open(f.root)
  return new ThreadService(
    f.db,
    f.hub,
    {
      resolve: async () => submit.model,
      getModel: async () => ({}),
      getPiModel: async () => setup.model,
      pi: setup.models,
    } as never,
    {} as never,
    { setResumeHandler: () => {} } as never,
    {
      toolExposure: () => ({ eager: ['Read', 'Write'], exposed: ['Read', 'Write'], deferred: [] }),
      clearTurnPermissionGrants: () => {},
      abort: async () => {},
      run,
    } as never,
    {
      setParentResumeHandler: () => {},
      resolvedWaitCheckpoint: () => null,
      collaboration: { saved: () => null, available: false },
      deferCompletion: async () => false,
      reconcileCompletions: async () => {},
      delegationFor: () => undefined,
      stopChildrenForParent: async () => {},
    } as never,
    { listByBinding: async () => [] } as never,
    { dataRoot: f.root, userHome: f.root },
    { recall: () => [], enqueue: () => null } as never,
    { load: () => {}, run: async () => [] } as never,
    {
      resolve: async () => ({
        kind: 'projectless',
        workspace,
        workspaceRoot: f.root,
        cwd: f.root,
        outputDirectory: f.root,
      }),
    } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    f.service,
  )
}

describe('Goal settlement integration', () => {
  test('external input permits a budget increase with a pause notice, and only new input plus explicit resume delivers', async () => {
    const f = await fixture(6000)
    finish(f, 'required.txt 不存在，尚未生成 delivery.md', {
      tool: 'Read',
      output: 'required.txt missing',
    })
    f.db.repositories.threadGoalLedger.refreshMeasurement(f.thread.id, 'budget-limited')
    const setup = provider()
    let audits = 0
    setup.models.completeSimple = (async (_model, context) => {
      audits++
      expect(JSON.stringify(context.messages)).toContain('&quot;budgetLimit&quot;:206000')
      const input = await readFile(join(f.root, 'required.txt'), 'utf8').catch(() => null)
      const delivery = await readFile(join(f.root, 'delivery.md'), 'utf8').catch(() => null)
      return fauxAssistantMessage(
        JSON.stringify({
          passed: input !== null && delivery === input,
          reason:
            input === null
              ? '缺 required.txt'
              : delivery === input
                ? '实际文件读回一致'
                : '尚未生成交付',
          nextAction:
            input === null
              ? '用户提供 required.txt 后明确恢复'
              : delivery === input
                ? ''
                : '生成 delivery.md 并读回',
          continuation: input === null ? 'external-input' : 'work',
          progress: 'advanced',
          requirements: [
            {
              requirement: '根据输入生成交付',
              kind: 'deliverable',
              fulfilled: input !== null && delivery === input,
              evidence: delivery ?? '',
            },
          ],
        }),
      )
    }) as typeof setup.models.completeSimple
    let runs = 0
    const threads = await threadService(f, setup, async (request) => {
      runs++
      const input = await readFile(join(f.root, 'required.txt'), 'utf8')
      await writeFile(join(f.root, 'delivery.md'), input, 'utf8')
      const output = await readFile(join(f.root, 'delivery.md'), 'utf8')
      f.db.upsertItem(f.thread.id, {
        id: crypto.randomUUID(),
        turnID: request.turnID,
        agentID: request.agentID,
        type: 'tool',
        status: 'completed',
        data: { tool: 'Read', output },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return { status: 'completed', output }
    })
    const appended = await f.service.set({
      threadId: f.thread.id,
      tokenBudget: 206000,
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'external-append',
    })
    expect(appended.goal).toMatchObject({ status: 'paused', tokenBudget: 206000 })
    expect(audits).toBe(1)
    const notice = f.db.sqlite
      .query(
        "SELECT data FROM items WHERE thread_id = ? AND json_extract(data, '$.phase') = 'notice'",
      )
      .all(f.thread.id)
    expect(JSON.stringify(notice)).toContain('预算上限已调整为 206000')
    expect(JSON.stringify(notice)).toContain('required.txt')
    await threads.resumeGoalContinuation(f.thread.id)
    expect(runs).toBe(0)
    const paused = gate()
    const done = gate()
    const unlisten = f.hub.listen(({ event }) => {
      if (event.method === 'thread/goal/updated') {
        const status = f.service.get(f.thread.id).goal!.status
        if (status === 'paused') paused.release()
        if (status === 'complete') done.release()
      }
    })
    const resume = async (operationId: string) => {
      await f.service.set({
        threadId: f.thread.id,
        status: 'active',
        expectedVersion: f.service.get(f.thread.id).goal!.version,
        operationId,
      })
      await threads.resumeGoalContinuation(f.thread.id)
    }
    try {
      await resume('external-resume-without-input')
      await bounded(paused.promise)
      expect(runs).toBe(0)
      expect(audits).toBe(2)
      await writeFile(join(f.root, 'required.txt'), 'new input', 'utf8')
      finish(f, '新输入已读回，保持暂停', {
        tool: 'Read',
        output: await readFile(join(f.root, 'required.txt'), 'utf8'),
      })
      expect(f.service.get(f.thread.id).goal!.status).toBe('paused')
      await resume('external-resume-with-input')
      await bounded(done.promise)
      expect(runs).toBe(1)
      expect(audits).toBe(4)
      expect(await readFile(join(f.root, 'delivery.md'), 'utf8')).toBe('new input')
      expect(queued(f)).toBe(0)
    } finally {
      unlisten()
    }
  })
  test.each([false, true])(
    'T06 queued admission audits before appending and resumes real delivery (explicit paused resume: %s)',
    async (paused) => {
      const f = await fixture(6000)
      await f.service.clear({
        threadId: f.thread.id,
        expectedVersion: f.goal.version,
        operationId: 'replace',
      })
      const first = f.db.createTurn(f.thread.id, submit)
      new QueuedGoalRepository(f.db).put(first.inputID, {
        objective: '创建并读回 first.md 和 second.md',
        tokenBudget: 6000,
      })
      // Force the real queued-admission ordering without depending on clock resolution.
      f.db.sqlite
        .query('UPDATE turns SET created_at = created_at - 42 WHERE id = ?')
        .run(first.turnID)
      f.db.startTurnExecution(first.turnID, { ...submit, id: first.inputID }, () =>
        f.service.applyInputInTransaction(f.thread.id, first.inputID, 'chat'),
      )
      const goal = f.service.get(f.thread.id).goal!
      f.db.upsertItem(f.thread.id, {
        id: crypto.randomUUID(),
        turnID: first.turnID,
        agentID: first.agentID,
        type: 'text',
        status: 'completed',
        data: {
          text: '旧收尾轮：预算不足，工具被禁用，两个文件未创建。需等待额度恢复、工具可用。',
          placement: 'result',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      f.db.finalizeTurn({
        threadID: f.thread.id,
        turnID: first.turnID,
        agentID: first.agentID,
        status: 'completed',
      })
      f.db.repositories.threadGoalLedger.refreshMeasurement(f.thread.id, 'budget-limited')
      const setup = provider()
      let audits = 0
      setup.models.completeSimple = (async (_model, context) => {
        audits++
        expect(f.service.get(f.thread.id).goal!.tokenBudget).toBe(audits <= 2 ? 6000 : 206000)
        if (audits === 1) throw new Error('preflight provider unavailable')
        const prompt = JSON.stringify(context.messages)
        expect(prompt).toContain('&quot;budgetLimit&quot;:206000')
        expect(prompt).toContain('&quot;remainingTokens&quot;:206000')
        expect(prompt).toContain('&quot;exposedTools&quot;:[&quot;Read&quot;,&quot;Write&quot;]')
        expect(context.systemPrompt).toContain('disabled tools for that request only')
        if (paused && audits === 3) {
          expect(prompt).toContain('&quot;purpose&quot;:&quot;settlement&quot;')
          expect(prompt).toContain('&quot;goalStatus&quot;:&quot;active&quot;')
          expect(prompt).toContain('旧收尾轮')
        }
        if (paused && audits === 4)
          return fauxAssistantMessage(
            JSON.stringify({
              passed: true,
              reason: '文件实际读回',
              nextAction: '',
              continuation: 'work',
              progress: 'advanced',
              requirements: [
                {
                  requirement: '两个文件',
                  kind: 'deliverable',
                  fulfilled: true,
                  evidence: 'Read first.md and second.md',
                },
              ],
            }),
          )
        return fauxAssistantMessage(
          JSON.stringify({
            passed: false,
            reason: '两个文件缺失',
            nextAction: '创建两个文件并读回',
            continuation: 'work',
            progress: 'unchanged',
            requirements: [
              { requirement: '两个文件', kind: 'deliverable', fulfilled: false, evidence: '' },
            ],
          }),
        )
      }) as typeof setup.models.completeSimple
      const done = gate()
      let runs = 0
      const threads = await threadService(f, setup, async (request) => {
        runs++
        for (const name of ['first.md', 'second.md']) {
          await writeFile(join(f.root, name), name, 'utf8')
          expect(await readFile(join(f.root, name), 'utf8')).toBe(name)
        }
        if (paused)
          f.db.upsertItem(f.thread.id, {
            id: crypto.randomUUID(),
            turnID: request.turnID,
            agentID: request.agentID,
            type: 'tool',
            status: 'completed',
            data: {
              tool: 'Read',
              output: {
                first: await readFile(join(f.root, 'first.md'), 'utf8'),
                second: await readFile(join(f.root, 'second.md'), 'utf8'),
              },
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        else
          await f.service.set({
            threadId: f.thread.id,
            status: 'complete',
            expectedVersion: f.service.get(f.thread.id).goal!.version,
            operationId: 't06-delivered',
          })
        return { status: 'completed', output: '两个文件已创建并读回' }
      })
      const unlisten = f.hub.listen(({ event }) => {
        if (
          (!paused && event.method === 'turn/completed') ||
          (paused &&
            event.method === 'thread/goal/updated' &&
            f.service.get(f.thread.id).goal!.status === 'complete')
        )
          done.release()
      })
      try {
        expect(f.db.repositories.threadGoalControls.latestGoalTurn(f.thread.id)?.id).toBe(
          first.turnID,
        )
        await expect(
          f.service.set({
            threadId: f.thread.id,
            tokenBudget: 206000,
            expectedVersion: f.service.get(f.thread.id).goal!.version,
            operationId: 't06-failed-append',
          }),
        ).rejects.toMatchObject({ code: 'GOAL_VERIFICATION_UNAVAILABLE' })
        expect(f.service.get(f.thread.id).goal).toMatchObject({
          tokenBudget: 6000,
          status: 'budget-limited',
        })
        if (paused)
          await f.service.set({
            threadId: f.thread.id,
            status: 'paused',
            expectedVersion: f.service.get(f.thread.id).goal!.version,
            operationId: 't06-pause',
          })
        const result = await f.service.set({
          threadId: f.thread.id,
          tokenBudget: 206000,
          expectedVersion: f.service.get(f.thread.id).goal!.version,
          operationId: 't06-append',
        })
        expect(audits).toBe(2)
        expect(result.goal).toMatchObject({
          status: paused ? 'paused' : 'active',
          tokenBudget: 206000,
        })
        expect(runs).toBe(0)
        if (paused)
          await f.service.set({
            threadId: f.thread.id,
            status: 'active',
            expectedVersion: f.service.get(f.thread.id).goal!.version,
            operationId: 't06-resume',
          })
        await threads.resumeGoalContinuation(f.thread.id)
        await bounded(done.promise)
        expect(runs).toBe(1)
        expect(audits).toBe(paused ? 4 : 2)
        expect(f.service.get(f.thread.id).goal!.status).toBe('complete')
        expect(queued(f)).toBe(0)
        expect(
          f.db.repositories.threadGoalControls.verifierEvidence({
            threadId: f.thread.id,
            goalId: goal.id,
            turnId: first.turnID,
          }).length,
        ).toBeGreaterThan(0)
      } finally {
        unlisten()
      }
    },
  )
  test('a delayed verifier failure starts the actual next ThreadService turn', async () => {
    const f = await fixture()
    const setup = provider()
    const verifyEntered = gate()
    const verifyRelease = gate()
    const nextDone = gate()
    setup.models.completeSimple = (async () => {
      verifyEntered.release()
      await verifyRelease.promise
      return fauxAssistantMessage(
        '{"passed":false,"reason":"缺验证","nextAction":"运行验证","continuation":"work","progress":"advanced","requirements":[{"requirement":"交付结果","kind":"deliverable","fulfilled":false,"evidence":""}]}',
      )
    }) as typeof setup.models.completeSimple
    let runs = 0
    const threads = await threadService(f, setup, async (request) => {
      runs++
      if (runs === 2)
        await f.service.set({
          threadId: f.thread.id,
          status: 'complete',
          expectedVersion: f.service.get(f.thread.id).goal!.version,
          operationId: 'finished',
        })
      f.db.upsertItem(f.thread.id, {
        id: crypto.randomUUID(),
        turnID: request.turnID,
        agentID: request.agentID,
        type: 'text',
        status: 'completed',
        data: { text: '交付文本', placement: 'result' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return { status: 'completed', output: '交付文本' }
    })
    const turn = f.db.createTurn(f.thread.id, submit)
    const unlisten = f.hub.listen(({ event }) => {
      if (event.method === 'turn/completed' && event.turnId !== turn.turnID) nextDone.release()
    })
    await (
      threads as unknown as { executeTurn(threadId: string, turnId: string): Promise<void> }
    ).executeTurn(f.thread.id, turn.turnID)
    await bounded(verifyEntered.promise)
    expect(runs).toBe(1)
    expect(f.db.activeTurn(f.thread.id)).toBeNull()
    verifyRelease.release()
    await bounded(nextDone.promise)
    unlisten()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(runs).toBe(2)
    expect(queued(f)).toBe(0)
    expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
  })

  test('Stop also cancels a verifier after its source turn has already completed', async () => {
    const f = await fixture()
    const setup = provider()
    const entered = gate()
    const release = gate()
    const settled = gate()
    setup.models.completeSimple = (async (_model, _context, options) => {
      options?.signal?.addEventListener('abort', () => settled.release(), { once: true })
      entered.release()
      await release.promise
      return fauxAssistantMessage(
        '{"passed":true,"reason":"齐全","nextAction":"","continuation":"work","progress":"advanced","requirements":[{"requirement":"交付结果","kind":"deliverable","fulfilled":true,"evidence":"交付证据"}]}',
      )
    }) as typeof setup.models.completeSimple
    const threads = await threadService(f, setup, async (request) => {
      f.db.upsertItem(f.thread.id, {
        id: crypto.randomUUID(),
        turnID: request.turnID,
        agentID: request.agentID,
        type: 'text',
        status: 'completed',
        data: { text: '交付', placement: 'result' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return { status: 'completed', output: '交付' }
    })
    const turn = f.db.createTurn(f.thread.id, submit)
    await (
      threads as unknown as { executeTurn(threadId: string, turnId: string): Promise<void> }
    ).executeTurn(f.thread.id, turn.turnID)
    await bounded(entered.promise)
    await threads.stop(f.thread.id, turn.turnID)
    await bounded(settled.promise)
    release.release()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.service.get(f.thread.id).goal?.status).toBe('paused')
    expect(queued(f)).toBe(0)
  })

  test('startup recovers a completed turn whose post-commit settlement never ran', async () => {
    const f = await fixture()
    finish(f)
    const setup = provider()
    const done = gate()
    setup.models.completeSimple = (async () =>
      fauxAssistantMessage(
        '{"passed":true,"reason":"证据齐全","nextAction":"","continuation":"work","progress":"advanced","requirements":[{"requirement":"交付结果","kind":"deliverable","fulfilled":true,"evidence":"交付证据"}]}',
      )) as typeof setup.models.completeSimple
    const threads = await threadService(f, setup, async () => {
      throw new Error('verification should complete before continuation')
    })
    const unlisten = f.hub.listen(({ event }) => {
      if (
        event.method === 'thread/goal/updated' &&
        f.service.get(f.thread.id).goal?.status === 'complete'
      )
        done.release()
    })
    threads.startRecoveredQueues()
    await bounded(done.promise)
    unlisten()
    expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
    expect(queued(f)).toBe(0)
  })

  test('finalize creates pending work; verifier completion persists and publishes the Goal event', async () => {
    const f = await fixture()
    const turn = finish(f)
    expect(
      f.db.repositories.threadGoalControls.observationForTurn(f.goal.id, turn.turnID)?.processing,
    ).toBe('pending')
    const events: string[] = []
    const unlisten = f.hub.listen(({ event }) => events.push(event.method))
    await coordinator(f, async () => pass).settle({ threadId: f.thread.id, turnId: turn.turnID })
    unlisten()
    expect(events).toContain('thread/goal/updated')
    expect(
      f.db.sqlite
        .query(
          "SELECT 1 FROM events WHERE method = 'thread/goal/updated' AND json_extract(params, '$.goal.status') = 'complete'",
        )
        .get(),
    ).not.toBeNull()
    expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
    expect(
      f.db.repositories.threadGoalControls.observationForTurn(f.goal.id, turn.turnID)?.processing,
    ).toBe('settled')
  })

  test('concurrent callbacks cannot create a continuation while the verifier owns the source', async () => {
    const f = await fixture()
    const turn = finish(f)
    const wait = gate()
    let calls = 0
    const c = coordinator(f, async () => {
      calls++
      await wait.promise
      return pass
    })
    const first = c.settle({ threadId: f.thread.id, turnId: turn.turnID })
    await c.settle({ threadId: f.thread.id, turnId: turn.turnID })
    expect(queued(f)).toBe(0)
    expect(calls).toBe(1)
    wait.release()
    await first
    expect(queued(f)).toBe(0)
    expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
  })

  test.each([pass, fail, { kind: 'error', code: 'provider_failed' } as GoalVerifierOutcome])(
    'pause invalidates every verifier outcome, not just a pass',
    async (outcome) => {
      const f = await fixture()
      const turn = finish(f)
      const wait = gate()
      let signal!: AbortSignal
      const c = coordinator(f, async (input) => {
        signal = input.signal
        await wait.promise
        return outcome
      })
      const pending = c.settle({ threadId: f.thread.id, turnId: turn.turnID })
      await f.service.set({
        threadId: f.thread.id,
        status: 'paused',
        expectedVersion: f.service.get(f.thread.id).goal!.version,
        operationId: 'pause',
      })
      expect(signal.aborted).toBe(true)
      wait.release()
      await pending
      expect(queued(f)).toBe(0)
      expect(f.service.get(f.thread.id).goal?.status).toBe('paused')
      expect(
        f.db.repositories.threadGoalControls.verification(f.goal.id, 1, turn.turnID)?.status,
      ).toBe('stale')
    },
  )

  test('a newer running user turn prevents the old verifier completing the goal', async () => {
    const f = await fixture()
    const turn = finish(f)
    const wait = gate()
    const c = coordinator(f, async () => {
      await wait.promise
      return pass
    })
    const pending = c.settle({ threadId: f.thread.id, turnId: turn.turnID })
    const next = f.db.createTurn(f.thread.id, submit)
    f.db.claimTurnExecution(next.turnID)
    wait.release()
    await pending
    expect(f.service.get(f.thread.id).goal?.status).toBe('active')
    expect(f.db.getTurnStatus(next.turnID)).toBe('running')
    expect(
      f.db.repositories.threadGoalControls.verification(f.goal.id, 1, turn.turnID)?.status,
    ).toBe('stale')
  })

  test('false verdict reaches the next turn as escaped reference, including earlier evidence and the plan', async () => {
    const f = await fixture()
    const first = finish(f, '第一轮文件证据', {
      tool: 'Write',
      input: { file_path: 'src/delivered.ts' },
      output: 'written',
    })
    await coordinator(f, async () => fail).settle({ threadId: f.thread.id, turnId: first.turnID })
    const next = f.db.nextQueuedTurn(f.thread.id)!
    const agent = f.db.agentForTurn(next.id)!
    f.db.claimTurnExecution(next.id)
    f.db.updateExecutionPlan({
      threadID: f.thread.id,
      turnID: next.id,
      agentID: agent.id,
      plan: [{ step: '核心验证', status: 'in_progress' }],
    })
    f.db.upsertItem(f.thread.id, {
      id: crypto.randomUUID(),
      turnID: next.id,
      agentID: agent.id,
      type: 'text',
      status: 'completed',
      data: { text: '第二轮结果', placement: 'result' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    f.db.finalizeTurn({
      threadID: f.thread.id,
      turnID: next.id,
      agentID: agent.id,
      status: 'completed',
    })
    let evidence = ''
    await coordinator(f, async (input) => {
      evidence = input.evidence
      return fail
    }).settle({ threadId: f.thread.id, turnId: next.id })
    expect(evidence).toContain('src/delivered.ts')
    expect(evidence).toContain('第一轮文件证据')
    expect(evidence).toContain('核心验证')
    const content = f.db.getTurnInput(f.db.nextQueuedTurn(f.thread.id)!.id)!.content
    expect(content).toContain('Untrusted audit reference')
    expect(content).toContain('运行核心测试 &lt;core&gt;')
  })

  test('no-progress pause happens after verification, so a repeated text delivery can complete', async () => {
    const f = await fixture()
    const first = finish(f, '相同文字交付')
    await coordinator(f, async () => fail).settle({ threadId: f.thread.id, turnId: first.turnID })
    const next = f.db.nextQueuedTurn(f.thread.id)!
    const agent = f.db.agentForTurn(next.id)!
    f.db.claimTurnExecution(next.id)
    f.db.upsertItem(f.thread.id, {
      id: crypto.randomUUID(),
      turnID: next.id,
      agentID: agent.id,
      type: 'text',
      status: 'completed',
      data: { text: '相同文字交付', placement: 'result' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    f.db.finalizeTurn({
      threadID: f.thread.id,
      turnID: next.id,
      agentID: agent.id,
      status: 'completed',
    })
    expect(f.service.get(f.thread.id).goal?.status).toBe('active')
    await coordinator(f, async () => pass).settle({ threadId: f.thread.id, turnId: next.id })
    expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
  })

  test('recovery repairs a legacy settled observation with no recorded decision', async () => {
    const f = await fixture()
    const turn = finish(f)
    const controls = f.db.repositories.threadGoalControls
    controls.markProcessing(f.goal.id, 1, turn.turnID, 'settled')
    recoverInterruptedRuns(f.db)
    expect(controls.observationForTurn(f.goal.id, turn.turnID)?.processing).toBe('pending')
    await coordinator(f, async () => pass).settle({ threadId: f.thread.id, turnId: turn.turnID })
    expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
  })

  test('recovery reclaims an interrupted settlement without repeating its unknown verifier call', async () => {
    const f = await fixture()
    const turn = finish(f)
    const controls = f.db.repositories.threadGoalControls
    controls.claimObservation(f.goal.id, 1, turn.turnID)
    controls.claimVerification({
      goalId: f.goal.id,
      revision: 1,
      sourceTurnId: turn.turnID,
      threadId: f.thread.id,
      modelRef: 'faux',
    })
    f.db.close()
    f.db = new AgentDatabase(join(f.root, 'agent.sqlite'))
    fixtures[fixtures.length - 1]!.db = f.db
    recoverInterruptedRuns(f.db)
    let calls = 0
    await coordinator(f, async () => {
      calls++
      return pass
    }).settle({ threadId: f.thread.id, turnId: turn.turnID })
    expect(calls).toBe(0)
    expect(queued(f)).toBe(0)
    expect(f.db.repositories.threadGoals.get(f.thread.id)?.status).toBe('paused')
    expect(
      f.db.repositories.threadGoalControls.verification(f.goal.id, 1, turn.turnID)?.status,
    ).toBe('interrupted')
  })
})

describe('Goal provider integration', () => {
  test('verifier cannot spend the wrap-up reserve; no Provider request is sent', async () => {
    const f = await fixture(2000)
    const turn = finish(f)
    const setup = provider()
    let calls = 0
    setup.models.completeSimple = async () => {
      calls++
      throw new Error('must not call')
    }
    await coordinator(f, liveVerifier(setup.models, setup.model)).settle({
      threadId: f.thread.id,
      turnId: turn.turnID,
    })
    expect(calls).toBe(0)
    expect(
      f.db.repositories.threadGoalControls.verification(f.goal.id, 1, turn.turnID)?.error_code,
    ).toBe('budget_limited')
  })

  test('verifier caps output, disables retries and bills cancelled usage to the archived goal', async () => {
    const f = await fixture()
    const turn = finish(f)
    const setup = provider()
    const wait = gate()
    const entered = gate()
    let maxTokens: number | undefined
    let retries: number | undefined
    setup.models.completeSimple = (async (_model, _context, options) => {
      maxTokens = options?.maxTokens
      retries = options?.maxRetries
      entered.release()
      await wait.promise
      return {
        ...fauxAssistantMessage(
          '{"passed":true,"reason":"完成","nextAction":"","continuation":"work","progress":"advanced","requirements":[{"requirement":"交付结果","kind":"deliverable","fulfilled":true,"evidence":"交付证据"}]}',
        ),
        usage: {
          input: 100,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          totalTokens: 190,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
    }) as typeof setup.models.completeSimple
    const pending = coordinator(f, liveVerifier(setup.models, setup.model)).settle({
      threadId: f.thread.id,
      turnId: turn.turnID,
    })
    await bounded(entered.promise)
    await f.service.clear({
      threadId: f.thread.id,
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'clear',
    })
    const replacement = (
      await f.service.set({
        threadId: f.thread.id,
        objective: '新目标',
        expectedVersion: null,
        operationId: 'replace',
      })
    ).goal
    wait.release()
    await pending
    expect(maxTokens).toBe(1024)
    expect(retries).toBe(0)
    expect(f.db.repositories.threadGoalLedger.tokensUsed(f.goal.id)).toBe(190)
    expect(f.db.repositories.threadGoalLedger.tokensUsed(replacement.id)).toBe(0)
    const audit = f.db.sqlite
      .query('SELECT usage_item_id, status FROM thread_goal_verifications WHERE goal_id = ?')
      .get(f.goal.id) as { usage_item_id: string; status: string }
    expect(audit.usage_item_id).toBeTruthy()
    expect(audit.status).toBe('stale')
    expect(f.db.getItem(audit.usage_item_id)?.data).toHaveProperty('usage', expect.any(Object))
    expect(f.db.repositories.threadGoals.history(f.thread.id)[0]?.tokensUsed).toBe(190)
  })

  test('real admission and Harness send the first wrap-up with its instruction, no tools and 1024 output tokens', async () => {
    const f = await fixture(6000)
    // An upgraded goal may predate the extension control row; first use must create it.
    f.db.sqlite.query('DELETE FROM thread_goal_controls WHERE goal_id = ?').run(f.goal.id)
    const setup = provider()
    setup.faux.setResponses([fauxAssistantMessage('已完成文件；尚缺核心验证，请追加预算。')])
    const original = setup.models.streamSimple.bind(setup.models)
    let calls = 0
    let captured:
      | { tools: unknown; text: string; maxTokens: number | undefined; retries: number | undefined }
      | undefined
    setup.models.streamSimple = ((model, context, options) => {
      calls++
      captured = {
        tools: context.tools,
        text: JSON.stringify(context.messages),
        maxTokens: options?.maxTokens,
        retries: options?.maxRetries,
      }
      return original(model, context, options)
    }) as typeof setup.models.streamSimple
    const h = await harness(f, setup)
    expect((await h.run()).output).toContain('尚缺核心验证')
    expect(captured?.tools).toEqual([])
    expect(captured?.text).toContain('<goal_wrapup>')
    expect(captured?.maxTokens).toBe(1024)
    expect(captured?.retries).toBe(0)
    expect(f.service.get(f.thread.id).goal?.status).toBe('budget-limited')
    await expect(h.run()).rejects.toThrow()
    expect(calls).toBe(1)
  })

  test('a hallucinated tool call during wrap-up is rejected before tool execution', async () => {
    const f = await fixture(6000)
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('update_plan', { plan: [{ step: '不应执行', status: 'pending' }] }),
        { stopReason: 'toolUse' },
      ),
    ])
    const h = await harness(f, setup)
    let executions = 0
    h.runtime.lifecycle = {
      updatePlan: async () => {
        executions++
        return {}
      },
    }
    await expect(h.run()).rejects.toThrow()
    expect(executions).toBe(0)
    expect(f.service.get(f.thread.id).goal?.status).toBe('budget-limited')
  })

  test('insufficient input plus summary budget sends no Provider request', async () => {
    const f = await fixture(100)
    const setup = provider()
    let calls = 0
    setup.models.streamSimple = (() => {
      calls++
      throw new Error('must not call')
    }) as typeof setup.models.streamSimple
    const h = await harness(f, setup)
    await expect(h.run()).rejects.toThrow()
    expect(calls).toBe(0)
    expect(f.service.get(f.thread.id).goal?.status).toBe('budget-limited')
  })

  test('HTTP 200 followed by a failed stream does not consume the latest objective; a successful retry does', async () => {
    const f = await fixture()
    const setup = provider()
    await f.service.set({
      threadId: f.thread.id,
      objective: '第二目标',
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'edit1',
    })
    await f.service.set({
      threadId: f.thread.id,
      objective: '第三目标',
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'edit2',
    })
    setup.faux.setResponses([
      fauxAssistantMessage('partial', { stopReason: 'error', errorMessage: 'stream failed' }),
      fauxAssistantMessage('成功收到第三目标'),
    ])
    const original = setup.models.streamSimple.bind(setup.models)
    const contexts: string[] = []
    setup.models.streamSimple = ((model, context, options) => {
      contexts.push(JSON.stringify(context.messages))
      void options?.onResponse?.({ status: 200, headers: {} } as never, model)
      return original(model, context, options)
    }) as typeof setup.models.streamSimple
    const h = await harness(f, setup)
    await expect(h.run()).rejects.toThrow()
    expect(f.db.repositories.threadGoalControls.get(f.goal.id)?.objective_ack_revision).toBe(0)
    await h.run()
    expect(f.db.repositories.threadGoalControls.get(f.goal.id)?.objective_ack_revision).toBe(2)
    expect(
      contexts.every(
        (context) => context.includes('<goal_objective_updated>') && context.includes('第三目标'),
      ),
    ).toBe(true)
  })

  test('the actual Harness binds terminal tools to the goal seen by the Provider request', async () => {
    const f = await fixture()
    const setup = provider()
    const h = await harness(f, setup)
    h.request.exposedTools = ['update_goal']
    let conflict = false
    h.runtime.lifecycle = {
      updateGoal: async (input, id, _signal, identity) => {
        try {
          return await f.service.applyModelTerminal({
            threadId: f.thread.id,
            turnId: h.turn.turnID,
            status: input.status,
            ...(input.blocker ? { blocker: input.blocker } : {}),
            toolCallId: id,
            ...(identity ? { identity } : {}),
          })
        } catch (error) {
          conflict = true
          throw error
        }
      },
    }
    setup.faux.setResponses([
      () => {
        void f.service.set({
          threadId: f.thread.id,
          objective: '新的交付要求',
          expectedVersion: f.service.get(f.thread.id).goal!.version,
          operationId: 'during-request',
        })
        return fauxAssistantMessage(fauxToolCall('update_goal', { status: 'complete' }), {
          stopReason: 'toolUse',
        })
      },
      fauxAssistantMessage('已收到新目标，将重新核对'),
    ])
    await h.run()
    expect(conflict).toBe(true)
    expect(f.service.get(f.thread.id).goal?.status).toBe('active')
  })

  test('a terminal tool response bound to the previous goal revision cannot complete an edited objective', async () => {
    const f = await fixture()
    const turn = f.db.createTurn(f.thread.id, submit)
    await f.service.set({
      threadId: f.thread.id,
      objective: '改过的目标',
      expectedVersion: f.goal.version,
      operationId: 'edit',
    })
    await expect(
      f.service.applyModelTerminal({
        threadId: f.thread.id,
        turnId: turn.turnID,
        status: 'complete',
        toolCallId: 'stale',
        identity: { goalId: f.goal.id, revision: 1 },
      }),
    ).rejects.toThrow('Goal 已变化')
    expect(f.service.get(f.thread.id).goal?.status).toBe('active')
  })
  test('pausing during the same Turn rejects completion even with the latest revision', async () => {
    const f = await fixture()
    const turn = f.db.createTurn(f.thread.id, submit)
    f.db.claimTurnExecution(turn.turnID)
    await f.service.set({
      threadId: f.thread.id,
      status: 'paused',
      expectedVersion: f.goal.version,
      operationId: 'pause',
    })
    for (const status of ['complete', 'blocked'] as const) {
      await expect(
        f.service.applyModelTerminal({
          threadId: f.thread.id,
          turnId: turn.turnID,
          status,
          blocker: '缺少输入',
          toolCallId: status,
          identity: {
            goalId: f.goal.id,
            revision: f.db.repositories.threadGoalControls.revision(f.goal.id),
          },
        }),
      ).rejects.toThrow('未处于 active')
    }
    f.db.finalizeTurn({
      threadID: f.thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: 'completed',
    })
    expect(f.service.get(f.thread.id).goal?.status).toBe('paused')
    expect(queued(f)).toBe(0)
  })

  test('old admission and finalization cannot relimit an appended budget', async () => {
    const f = await fixture(51000)
    const h = await harness(f, provider())
    const budget = lifecycle(f)
    const decision = budget.checkAdmission(f.thread.id, 100000)
    if (decision.allowed) throw new Error('expected denied admission')
    await budget.handleAdmissionDenied(h.request, decision, 100000)
    expect(f.service.get(f.thread.id).goal?.status).toBe('budget-limited')
    await f.service.set({
      threadId: f.thread.id,
      tokenBudget: 200000,
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'append',
    })
    await budget.handleAdmissionDenied(h.request, decision, 100000)
    f.db.finalizeTurn({
      threadID: f.thread.id,
      turnID: h.turn.turnID,
      agentID: h.turn.agentID,
      status: 'interrupted',
      message: 'budget-limited',
      goalBudget: { goalId: f.goal.id, revision: decision.budgetStatus.revision! },
    })
    expect(f.service.get(f.thread.id).goal?.status).toBe('active')
    expect(budget.checkAdmission(f.thread.id, 1000).allowed).toBe(true)
  })

  test('long context enters compact text-only wrap-up instead of denying the summary', async () => {
    const f = await fixture(6000)
    const setup = provider()
    setup.faux.setResponses([fauxAssistantMessage('已完成部分工作，剩余验证需要追加预算。')])
    const original = setup.models.streamSimple.bind(setup.models)
    let inputLength = 0
    setup.models.streamSimple = ((model, context, options) => {
      inputLength = JSON.stringify(context).length
      expect(context.tools).toEqual([])
      expect(options?.maxTokens).toBe(1024)
      return original(model, context, options)
    }) as typeof setup.models.streamSimple
    const h = await harness(f, setup)
    h.request.content = '历史证据'.repeat(80000)
    expect((await h.run()).output).toContain('追加预算')
    expect(inputLength).toBeLessThan(14000)
    expect(h.request.content.length).toBe(320000)
    expect(f.service.get(f.thread.id).goal?.status).toBe('budget-limited')
  })

  test('budget appended while the denied Turn settles starts an actual continuation', async () => {
    const f = await fixture(51000)
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          passed: false,
          reason: '待交付',
          nextAction: '继续实现',
          continuation: 'work',
          progress: 'advanced',
          requirements: [
            { requirement: '交付', kind: 'deliverable', fulfilled: false, evidence: '' },
          ],
        }),
      ),
    ])
    let runs = 0
    const done = gate()
    const threads = await threadService(f, setup, async (request) => {
      runs++
      if (runs === 1) {
        f.db.repositories.threadGoalLedger.recordUsage([
          {
            threadId: f.thread.id,
            goalId: f.goal.id,
            agentId: request.agentID,
            sourceEntryId: 'overrun',
            inputTokens: 83763,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
          },
        ])
        const budget = lifecycle(f)
        const decision = budget.checkAdmission(f.thread.id, 1000)
        if (decision.allowed) throw new Error('expected overrun denial')
        await budget.handleAdmissionDenied(
          request as unknown as HarnessRuntimeRequest,
          decision,
          1000,
        )
        await f.service.set({
          threadId: f.thread.id,
          tokenBudget: 200000,
          expectedVersion: f.service.get(f.thread.id).goal!.version,
          operationId: 'append-racing',
        })
        await threads.resumeGoalContinuation(f.thread.id)
        throw new GoalBudgetLimitError('目标预算受限', {
          goalId: f.goal.id,
          revision: decision.budgetStatus.revision!,
        })
      }
      await f.service.set({
        threadId: f.thread.id,
        status: 'complete',
        expectedVersion: f.service.get(f.thread.id).goal!.version,
        operationId: 'done',
      })
      return { status: 'completed', output: '交付完成' }
    })
    const turn = f.db.createTurn(f.thread.id, submit)
    const unlisten = f.hub.listen(({ event }) => {
      if (event.method === 'turn/completed' && event.turnId !== turn.turnID) done.release()
    })
    try {
      await (
        threads as unknown as { executeTurn(threadId: string, turnId: string): Promise<void> }
      ).executeTurn(f.thread.id, turn.turnID)
      await bounded(done.promise)
      expect(runs).toBe(2)
      expect(queued(f)).toBe(0)
      expect(f.service.get(f.thread.id).goal?.tokensUsed).toBeGreaterThan(83763)
      expect(f.service.get(f.thread.id).goal?.status).toBe('complete')
    } finally {
      unlisten()
    }
  })
  test('a live verifier claiming pass for constraints alone does not complete a missing-input goal', async () => {
    const f = await fixture()
    await f.service.set({
      threadId: f.thread.id,
      objective: '等待必要输入后生成交付文件，不得自行创建输入',
      expectedVersion: f.goal.version,
      operationId: 'conditional',
    })
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          passed: true,
          reason: '没有创建输入，符合约束',
          nextAction: '',
          continuation: 'external-input',
          progress: 'advanced',
          requirements: [
            {
              requirement: '不得创建输入',
              kind: 'constraint',
              fulfilled: true,
              evidence: '没有文件变更',
            },
          ],
        }),
      ),
    ])
    const turn = finish(f, '输入不存在，未创建任何文件', {
      tool: 'Read',
      output: 'ENOENT: required input missing',
    })
    await coordinator(f, liveVerifier(setup.models, setup.model)).settle({
      threadId: f.thread.id,
      turnId: turn.turnID,
    })
    expect(f.service.get(f.thread.id).goal?.status).not.toBe('complete')
    const audit = f.db.sqlite
      .query('SELECT status FROM thread_goal_verifications WHERE goal_id = ?')
      .get(f.goal.id) as { status: string }
    expect(audit.status).toBe('fail')
  })
  test('missing external input pauses without polling, and an explicit resume rechecks delivery', async () => {
    const f = await fixture()
    const setup = provider()
    const verdict = (passed: boolean) =>
      fauxAssistantMessage(
        JSON.stringify({
          passed,
          reason: passed ? '输入已到且交付已读回' : '必要输入缺失',
          nextAction: passed ? '' : '请用户提供 required-input.txt',
          continuation: passed ? 'work' : 'external-input',
          progress: passed ? 'advanced' : 'unchanged',
          requirements: [
            {
              requirement: '交付',
              kind: 'deliverable',
              fulfilled: passed,
              evidence: passed ? '读回交付内容' : '',
            },
          ],
        }),
      )
    setup.faux.setResponses([verdict(false), verdict(true)])
    const turn = finish(f, '等待输入', {
      tool: 'Shell',
      input: { command: 'Test-Path required-input.txt' },
      output: 'False',
    })
    await coordinator(f, liveVerifier(setup.models, setup.model)).settle({
      threadId: f.thread.id,
      turnId: turn.turnID,
    })
    expect(f.service.get(f.thread.id).goal?.status).toBe('paused')
    expect(queued(f)).toBe(0)
    expect(
      f.db.sqlite
        .query(
          "SELECT data FROM items WHERE turn_id = ? AND json_extract(data, '$.phase') = 'notice'",
        )
        .all(turn.turnID).length,
    ).toBe(1)
    // External input is delivered through normal user work, not a polling timer.
    const supplied = finish(f, '用户已补输入，交付读回正确', {
      tool: 'Read',
      input: { path: 'deliverable.md' },
      output: 'actual delivery',
    })
    await f.service.set({
      threadId: f.thread.id,
      status: 'active',
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'explicit-resume',
    })
    let runs = 0
    const threads = await threadService(f, setup, async () => {
      runs++
      return { status: 'completed', output: '' }
    })
    const completed = gate()
    const unlisten = f.hub.listen(({ event }) => {
      if (
        event.method === 'thread/goal/updated' &&
        f.service.get(f.thread.id).goal?.status === 'complete'
      )
        completed.release()
    })
    try {
      await threads.resumeGoalContinuation(f.thread.id)
      await bounded(completed.promise)
      expect(runs).toBe(0)
      expect(queued(f)).toBe(0)
      expect(
        f.db.repositories.threadGoalControls.verification(
          f.goal.id,
          f.db.repositories.threadGoalControls.observationForTurn(f.goal.id, supplied.turnID)!
            .revision,
          supplied.turnID,
        )?.status,
      ).toBe('pass')
    } finally {
      unlisten()
    }
  })

  test('successful checks of identical evidence cannot defeat the no-progress stop', async () => {
    const f = await fixture()
    let turn: { turnID: string; agentID: string } = finish(f, '输入仍缺失', {
      tool: 'Shell',
      input: { command: 'Test-Path required-input.txt' },
      output: 'False',
    })
    const c = coordinator(f, async () => ({
      kind: 'verdict',
      verdict: { passed: false, reason: '尚缺输入', nextAction: '再次检查', continuation: 'work' },
    }))
    for (let round = 0; round < 3; round++) {
      const result = await c.settle({ threadId: f.thread.id, turnId: turn.turnID })
      if (round === 2) {
        expect(result.kind).toBe('paused')
        break
      }
      expect(result.kind).toBe('continued')
      const next = f.db.nextQueuedTurn(f.thread.id)!
      const agent = f.db.agentForTurn(next.id)!
      f.db.claimTurnExecution(next.id)
      f.db.upsertItem(f.thread.id, {
        id: crypto.randomUUID(),
        turnID: next.id,
        agentID: agent.id,
        type: 'tool',
        status: 'completed',
        data: {
          tool: 'Shell',
          input: { command: 'Test-Path required-input.txt' },
          output: 'False',
          durationMs: round + 1,
          callID: crypto.randomUUID(),
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      f.db.finalizeTurn({
        threadID: f.thread.id,
        turnID: next.id,
        agentID: agent.id,
        status: 'completed',
      })
      expect(
        f.db.repositories.threadGoalControls.observationForTurn(f.goal.id, next.id)?.classification,
      ).toBe('no-progress')
      turn = { ...turn, turnID: next.id, agentID: agent.id }
    }
    expect(f.service.get(f.thread.id).goal?.status).toBe('paused')
    expect(queued(f)).toBe(0)
  })

  test('finite budget admission uses the actual capped output allowance, not a 393216 maximum', async () => {
    const f = await fixture(206000)
    const budget = lifecycle(f)
    const decision = budget.checkAdmission(f.thread.id, 15000, 'main', 393216, 3072)
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.wrapup).not.toBe(true)
    expect(decision.maxTokens).toBe(16384)
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('update_plan', { plan: [{ step: '继续必要工作', status: 'in_progress' }] }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('正在执行工作'),
    ])
    const h = await harness(f, setup)
    let tools = 0
    h.runtime.lifecycle = {
      updatePlan: async () => {
        tools++
        return {}
      },
    }
    await h.run()
    expect(tools).toBe(1)
    expect(f.service.get(f.thread.id).goal?.status).toBe('active')
  })

  test('mid-turn budget change rejects stale tool scheduling and reaches the very next model request', async () => {
    const f = await fixture(100000)
    const setup = provider()
    const h = await harness(f, setup)
    let tools = 0
    h.runtime.lifecycle = {
      updatePlan: async () => {
        tools++
        return {}
      },
    }
    const contexts: string[] = []
    const original = setup.models.streamSimple.bind(setup.models)
    setup.models.streamSimple = ((model, context, options) => {
      contexts.push(JSON.stringify(context.messages))
      return original(model, context, options)
    }) as typeof setup.models.streamSimple
    setup.faux.setResponses([
      () => {
        void f.service.set({
          threadId: f.thread.id,
          tokenBudget: 200000,
          expectedVersion: f.service.get(f.thread.id).goal!.version,
          operationId: 'running-append',
        })
        return fauxAssistantMessage(
          fauxToolCall('update_plan', { plan: [{ step: '旧预算计划', status: 'in_progress' }] }),
          { stopReason: 'toolUse' },
        )
      },
      fauxAssistantMessage(
        fauxToolCall('update_plan', {
          plan: [{ step: '检查交付并重审剩余分工', status: 'in_progress' }],
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('不扩充范围，不为用完额度增加任务'),
    ])
    await h.run()
    expect(tools).toBe(1)
    expect(contexts[0]).not.toContain('<goal_budget_updated>')
    expect(contexts[1]).toContain('<goal_budget_updated>')
    expect(contexts[1]).toContain('100000 -> 200000')
    expect(contexts[1]).toContain('running child tasks')
    expect(contexts[2]).not.toContain('<goal_budget_updated>')
    expect(f.db.repositories.threadGoalControls.get(f.goal.id)).toMatchObject({
      budget_revision: 1,
      budget_ack_revision: 1,
    })
  })

  test('failed budget notification is reinjected, and child acknowledgement cannot consume the main receipt', async () => {
    const f = await fixture(100000)
    await f.service.set({
      threadId: f.thread.id,
      tokenBudget: 200000,
      expectedVersion: f.goal.version,
      operationId: 'append',
    })
    const setup = provider()
    const budget = lifecycle(f)
    const h = await harness(f, setup, budget)
    await budget.acknowledgeBudget!(
      { ...h.request, profile: 'worker' },
      budget.budgetChange!(f.thread.id)!,
    )
    expect(f.db.repositories.threadGoalControls.get(f.goal.id)?.budget_ack_revision).toBe(0)
    setup.faux.setResponses([
      fauxAssistantMessage('partial', { stopReason: 'error', errorMessage: 'stream failed' }),
      fauxAssistantMessage('已收到预算，先核对交付'),
    ])
    await expect(h.run()).rejects.toThrow()
    expect(f.db.repositories.threadGoalControls.get(f.goal.id)?.budget_ack_revision).toBe(0)
    await h.run()
    expect(f.db.repositories.threadGoalControls.get(f.goal.id)?.budget_ack_revision).toBe(1)
  })
  test('semantic no-progress stops reworded checks even when their raw tool evidence differs', async () => {
    const f = await fixture()
    const c = coordinator(f, async () => ({
      kind: 'verdict',
      verdict: {
        passed: false,
        reason: '只是换写法检查相同缺失条件',
        nextAction: '请用户提供输入',
        continuation: 'work',
        progress: 'unchanged',
      },
    }))
    const first = finish(f, '输入缺失', {
      tool: 'Shell',
      input: { command: 'Test-Path input.txt' },
      output: 'False',
    })
    expect((await c.settle({ threadId: f.thread.id, turnId: first.turnID })).kind).toBe('continued')
    const next = f.db.nextQueuedTurn(f.thread.id)!
    const agent = f.db.agentForTurn(next.id)!
    f.db.claimTurnExecution(next.id)
    f.db.upsertItem(f.thread.id, {
      id: crypto.randomUUID(),
      turnID: next.id,
      agentID: agent.id,
      type: 'tool',
      status: 'completed',
      data: {
        tool: 'Shell',
        input: { command: 'if (Test-Path ./input.txt) { echo yes } else { echo no }' },
        output: 'no',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    f.db.finalizeTurn({
      threadID: f.thread.id,
      turnID: next.id,
      agentID: agent.id,
      status: 'completed',
    })
    expect((await c.settle({ threadId: f.thread.id, turnId: next.id })).kind).toBe('paused')
    expect(queued(f)).toBe(0)
  })

  test('appending budget to a stopped Goal rechecks already delivered work without creating a Turn', async () => {
    const f = await fixture(6000)
    const source = finish(f, '交付已读回', {
      tool: 'Read',
      input: { path: 'done.md' },
      output: 'all requirements delivered',
    })
    f.db.repositories.threadGoalLedger.refreshMeasurement(f.thread.id, 'budget-limited')
    await f.service.set({
      threadId: f.thread.id,
      tokenBudget: 206000,
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'append-after-delivery',
    })
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          passed: true,
          reason: '交付证据齐全',
          nextAction: '',
          continuation: 'work',
          progress: 'advanced',
          requirements: [
            {
              requirement: '交付',
              kind: 'deliverable',
              fulfilled: true,
              evidence: 'done.md read output',
            },
          ],
        }),
      ),
    ])
    let runs = 0
    const threads = await threadService(f, setup, async () => {
      runs++
      return { status: 'completed', output: '' }
    })
    const done = gate()
    const unlisten = f.hub.listen(({ event }) => {
      if (
        event.method === 'thread/goal/updated' &&
        f.service.get(f.thread.id).goal?.status === 'complete'
      )
        done.release()
    })
    try {
      await threads.resumeGoalContinuation(f.thread.id)
      await bounded(done.promise)
      expect(runs).toBe(0)
      expect(queued(f)).toBe(0)
      expect(f.db.getTurnStatus(source.turnID)).toBe('completed')
    } finally {
      unlisten()
    }
  })
  test('a stopped Goal proven delivered rejects the proposed budget before saving it', async () => {
    const f = await fixture(6000)
    finish(f, '交付读回正确', { tool: 'Read', input: { path: 'done.md' }, output: 'delivered' })
    f.db.repositories.threadGoalLedger.refreshMeasurement(f.thread.id, 'budget-limited')
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          passed: true,
          reason: '交付齐全',
          nextAction: '',
          continuation: 'work',
          progress: 'advanced',
          requirements: [
            { requirement: '交付', kind: 'deliverable', fulfilled: true, evidence: 'done.md read' },
          ],
        }),
      ),
    ])
    let runs = 0
    await threadService(f, setup, async () => {
      runs++
      return { status: 'completed', output: '' }
    })
    await expect(
      f.service.set({
        threadId: f.thread.id,
        tokenBudget: 206000,
        expectedVersion: f.service.get(f.thread.id).goal!.version,
        operationId: 'unneeded-budget',
      }),
    ).rejects.toThrow('目标已完成')
    expect(f.service.get(f.thread.id).goal).toMatchObject({ status: 'complete', tokenBudget: 6000 })
    expect(runs).toBe(0)
    expect(queued(f)).toBe(0)
  })

  test('an unfinished stopped Goal can widen its budget and reuse the preflight audit before real continuation', async () => {
    const f = await fixture(6000)
    finish(f, '还有必需交付未完成', {
      tool: 'Read',
      input: { path: 'todo.md' },
      output: 'one requirement unfinished',
    })
    f.db.repositories.threadGoalLedger.refreshMeasurement(f.thread.id, 'budget-limited')
    const setup = provider()
    setup.faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          passed: false,
          reason: '还有交付',
          nextAction: '完成剩余实现',
          continuation: 'work',
          progress: 'advanced',
          requirements: [
            { requirement: '交付', kind: 'deliverable', fulfilled: false, evidence: '' },
          ],
        }),
      ),
    ])
    let audits = 0
    const original = setup.models.completeSimple.bind(setup.models)
    setup.models.completeSimple = ((...args: Parameters<typeof original>) => {
      audits++
      return original(...args)
    }) as typeof setup.models.completeSimple
    let runs = 0
    const done = gate()
    const threads = await threadService(f, setup, async () => {
      runs++
      await f.service.set({
        threadId: f.thread.id,
        status: 'complete',
        expectedVersion: f.service.get(f.thread.id).goal!.version,
        operationId: 'delivered',
      })
      return { status: 'completed', output: '交付完成' }
    })
    const unlisten = f.hub.listen(({ event }) => {
      if (event.method === 'turn/completed') done.release()
    })
    try {
      const result = await f.service.set({
        threadId: f.thread.id,
        tokenBudget: 206000,
        expectedVersion: f.service.get(f.thread.id).goal!.version,
        operationId: 'needed-budget',
      })
      expect(result.goal).toMatchObject({ status: 'active', tokenBudget: 206000 })
      await threads.resumeGoalContinuation(f.thread.id)
      await bounded(done.promise)
      expect(runs).toBe(1)
      expect(audits).toBe(1)
      expect(queued(f)).toBe(0)
    } finally {
      unlisten()
    }
  })

  test('a failed preflight keeps the old budget and a user retry can audit again', async () => {
    const f = await fixture(6000)
    finish(f, '仍需交付', { tool: 'Read', output: 'unfinished' })
    f.db.repositories.threadGoalLedger.refreshMeasurement(f.thread.id, 'budget-limited')
    let attempts = 0
    const c = coordinator(f, async () => {
      attempts++
      return attempts === 1 ? { kind: 'error', code: 'provider_failed' } : fail
    })
    f.service.setBudgetReviewer((threadId, budget) => c.reviewBudgetChange(threadId, budget))
    const input = {
      threadId: f.thread.id,
      tokenBudget: 206000,
      expectedVersion: f.service.get(f.thread.id).goal!.version,
      operationId: 'retry-budget',
    }
    await expect(f.service.set(input)).rejects.toMatchObject({
      code: 'GOAL_VERIFICATION_UNAVAILABLE',
    })
    expect(f.service.get(f.thread.id).goal).toMatchObject({
      status: 'budget-limited',
      tokenBudget: 6000,
    })
    expect((await f.service.set(input)).goal.tokenBudget).toBe(206000)
    expect(attempts).toBe(2)
  })
})
