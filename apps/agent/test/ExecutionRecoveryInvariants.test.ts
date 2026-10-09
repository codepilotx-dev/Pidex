import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { QuestionAutoResolutionScheduler } from '../src/interaction/QuestionAutoResolutionScheduler'
import { StartupRecoveryCoordinator } from '../src/storage/recovery/StartupRecoveryCoordinator'
import { EventSubscriptionRegistry } from '../src/transport/EventSubscriptionRegistry'
import { EventHub } from '../src/storage/events/EventHub'
import { QuestionService } from '../src/session/QuestionService'
import type { ResolvedResumeCheckpoint } from '../src/interaction/Types'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'
import { ThreadReadViewRepository } from '../src/session/ThreadReadViewRepository'
import { ThreadService } from '../src/session/ThreadService'

const databases: AgentDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

const setup = () => {
  const db = new AgentDatabase(
    join(tmpdir(), `pidex-recovery-invariants-${crypto.randomUUID()}.sqlite`),
  )
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: 'resume',
    model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    },
    strategy: 'queue',
    taskMode: 'chat',
  })
  return { db, thread, turn }
}

describe('执行恢复不变量', () => {
  test('resume lease 同 lease 幂等、不同 lease 排他且同 turn 可消费连续 checkpoint', () => {
    const { db, turn } = setup()
    const repository = db.repositories.interactions
    const first: ResolvedResumeCheckpoint = {
      kind: 'subagent-wait',
      state: 'first',
      interruption: null,
      answer: null,
    }
    const input = {
      turnID: turn.turnID,
      agentID: turn.agentID,
      kind: 'subagent-wait' as const,
      checkpoint: first,
      consumer: 'main' as const,
      leaseID: 'lease:first',
    }
    expect(repository.acquireResumeCheckpointLease(input)?.checkpoint).toEqual(first)
    expect(repository.acquireResumeCheckpointLease(input)?.leaseID).toBe('lease:first')
    expect(repository.acquireResumeCheckpointLease({ ...input, leaseID: 'lease:other' })).toBeNull()
    expect(repository.completeResumeCheckpointLease('lease:first')).toBe(true)
    expect(repository.completeResumeCheckpointLease('lease:first')).toBe(true)

    const second: ResolvedResumeCheckpoint = {
      kind: 'subagent-wait',
      state: 'second',
      interruption: { step: 2 },
      answer: null,
    }
    expect(
      repository.acquireResumeCheckpointLease({
        ...input,
        checkpoint: second,
        leaseID: 'lease:second',
      })?.checkpoint,
    ).toEqual(second)
  })

  test('用户停止后的 terminal lease 完成不会在重启时复活 turn', () => {
    const { db, turn } = setup()
    const checkpoint: ResolvedResumeCheckpoint = {
      kind: 'subagent-wait',
      state: 'wait',
      interruption: null,
      answer: null,
    }
    db.repositories.interactions.acquireResumeCheckpointLease({
      turnID: turn.turnID,
      agentID: turn.agentID,
      kind: 'subagent-wait',
      checkpoint,
      consumer: 'subagent',
      leaseID: 'lease:stopped',
    })
    db.updateTurnStatus(turn.turnID, 'interrupted')
    db.updateAgentStatus(turn.agentID, 'interrupted')
    expect(db.repositories.interactions.completeResumeCheckpointLease('lease:stopped')).toBe(true)
    db.repositories.interactions.recoverResumeCheckpointLeases()
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(
      db.sqlite
        .query('SELECT status FROM resume_checkpoint_leases WHERE turn_id = ?')
        .get(turn.turnID),
    ).toEqual({ status: 'completed' })
  })

  test('启动先中断 running turn 后，安全 lease 释放会把 turn 重新排队', () => {
    const { db, turn } = setup()
    db.claimTurnExecution(turn.turnID)
    const checkpoint: ResolvedResumeCheckpoint = {
      kind: 'subagent-wait',
      state: 'wait',
      interruption: null,
      answer: null,
    }
    db.repositories.interactions.acquireResumeCheckpointLease({
      turnID: turn.turnID,
      agentID: turn.agentID,
      kind: 'subagent-wait',
      checkpoint,
      consumer: 'main',
      leaseID: 'lease:recover',
    })
    recoverInterruptedRuns(db)
    db.repositories.interactions.recoverResumeCheckpointLeases()
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
    expect(
      db.sqlite
        .query('SELECT status FROM resume_checkpoint_leases WHERE turn_id = ?')
        .get(turn.turnID),
    ).toEqual({ status: 'available' })
  })

  test('宿主工具结果已落库但 Pi settlement 未提交时只重开 continuation，不重复工具', () => {
    const { db, thread, turn } = setup()
    db.claimTurnExecution(turn.turnID)
    db.sqlite
      .query(
        `
      INSERT INTO approval_requests (
        id, thread_id, turn_id, agent_id, tool_call_id, risk, reason,
        status, reply, request_payload, created_at, resolved_at
      ) VALUES ('approval:tool-result', ?, ?, ?, 'tool:completed', 'high', 'test',
        'resolved', 'allow', '{}', ?, ?)
    `,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now(), Date.now())
    const checkpoint: ResolvedResumeCheckpoint = {
      kind: 'permission',
      approvalID: 'approval:tool-result',
      toolCallID: 'tool:completed',
      state: 'resume',
      interruption: { call: 'tool:completed' },
      decision: 'allow',
      answer: null,
    }
    db.repositories.interactions.acquireResumeCheckpointLease({
      turnID: turn.turnID,
      agentID: turn.agentID,
      kind: 'permission',
      checkpoint,
      consumer: 'main',
      leaseID: 'lease:tool-result',
    })
    db.upsertToolCall(
      {
        id: 'tool:completed',
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        name: 'PowerShell',
        input: { command: 'test' },
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        model: Model.Ref.make({
          providerID: Provider.ID.make('openai'),
          id: Model.ID.make('test'),
        }),
        taskMode: 'chat',
      },
      'completed',
      { stdout: 'durable', stderr: '', exitCode: 0 },
    )

    recoverInterruptedRuns(db)
    db.repositories.interactions.recoverResumeCheckpointLeases()
    expect(
      db.sqlite
        .query('SELECT status FROM resume_checkpoint_leases WHERE turn_id = ?')
        .get(turn.turnID),
    ).toEqual({ status: 'available' })
    expect(
      db.sqlite
        .query("SELECT status FROM approval_requests WHERE id = 'approval:tool-result'")
        .get(),
    ).toEqual({ status: 'resolved' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
    expect(db.completedToolCall('tool:completed')?.output).toMatchObject({
      stdout: 'durable',
      exitCode: 0,
    })
    expect(db.hasPersistedToolResult(turn.turnID, 'tool:completed')).toBe(false)
  })

  test('stop interaction 将 terminal state、outbox 与 operation result 原子提交', () => {
    const { db, thread, turn } = setup()
    db.claimTurnExecution(turn.turnID)
    db.sqlite
      .query(
        `
      INSERT INTO approval_requests (
        id, thread_id, turn_id, agent_id, tool_call_id, risk, reason,
        status, request_payload, created_at
      ) VALUES ('approval:stop', ?, ?, ?, 'tool:stop', 'high', 'test', 'pending', '{}', ?)
    `,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    const response = { kind: 'approval', decision: 'stop' }
    const result = { interactionId: 'approval:stop', kind: 'approval', state: 'resolved' }
    const stopped = db.repositories.interactions.resolveStopInteraction({
      interactionID: 'approval:stop',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      operation: {
        operationID: 'operation:stop',
        interactionID: 'approval:stop',
        response,
        result,
      },
    })
    expect(stopped.events.some((event) => event.method === 'turn/interrupted')).toBe(true)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'approval:stop'").get(),
    ).toEqual({ status: 'cancelled' })
    expect(db.repositories.interactions.interactionOperation('operation:stop')?.result).toEqual(
      result,
    )
  })

  test('Hook trust gate 崩溃后可重新获取，完成旧 gate 不删除后继 checkpoint', () => {
    const { db, thread, turn } = setup()
    db.claimTurnExecution(turn.turnID)
    const pending = db.ensureHookTrustRequest({
      threadID: thread.id,
      turnID: turn.turnID,
      workspacePath: 'C:/workspace',
      configPath: 'C:/workspace/.pidex/hooks.json',
      configHash: 'b'.repeat(64),
      auditSummary: { hooks: [] },
    })
    db.resolveHookTrustRequest(pending.request.id, 'allow')
    const checkpoint: ResolvedResumeCheckpoint = {
      kind: 'hook-trust',
      requestID: pending.request.id,
      state: '',
      interruption: null,
      decision: 'allow',
      answer: null,
    }
    const repository = db.repositories.interactions
    expect(
      repository.acquireResumeCheckpointLease({
        turnID: turn.turnID,
        agentID: turn.agentID,
        kind: 'hook-trust',
        checkpoint,
        consumer: 'main',
        leaseID: 'lease:hook-crash',
      })?.leaseID,
    ).toBe('lease:hook-crash')

    recoverInterruptedRuns(db)
    repository.recoverResumeCheckpointLeases()
    expect(
      db.sqlite
        .query('SELECT status FROM resume_checkpoint_leases WHERE turn_id = ?')
        .get(turn.turnID),
    ).toEqual({ status: 'available' })
    expect(db.getAgentTurnCheckpoint(turn.turnID)).toMatchObject({
      payload: { requestID: pending.request.id },
    })

    expect(
      repository.acquireResumeCheckpointLease({
        turnID: turn.turnID,
        agentID: turn.agentID,
        kind: 'hook-trust',
        checkpoint,
        consumer: 'main',
        leaseID: 'lease:hook-retry',
      })?.leaseID,
    ).toBe('lease:hook-retry')
    db.saveAgentTurnCheckpoint({
      agentID: turn.agentID,
      turnID: turn.turnID,
      threadID: thread.id,
      state: 'waiting_hook_trust',
      payload: { kind: 'hook-trust', requestID: 'next-request' },
      version: 1,
    })
    expect(repository.completeResumeCheckpointLease('lease:hook-retry')).toBe(true)
    expect(db.getAgentTurnCheckpoint(turn.turnID)).toMatchObject({
      state: 'waiting_hook_trust',
      payload: { requestID: 'next-request' },
    })
  })

  test('Hook trust profile 已提交但 history 未提交时，启动恢复会幂等收敛 waiter', () => {
    const { db, thread, turn } = setup()
    const pending = db.ensureHookTrustRequest({
      threadID: thread.id,
      turnID: turn.turnID,
      workspacePath: 'C:/workspace',
      configPath: 'C:/workspace/.pidex/hooks.json',
      configHash: 'a'.repeat(64),
      auditSummary: { hooks: [] },
    })
    db.profileSqlite
      .query(
        `
      INSERT INTO hook_trust_decisions (
        workspace_path, config_hash, config_path, decision, created_at, updated_at
      ) VALUES (?, ?, ?, 'allow', ?, ?)
    `,
      )
      .run('C:/workspace', 'a'.repeat(64), 'C:/workspace/.pidex/hooks.json', 1, 1)

    recoverInterruptedRuns(db)

    expect(db.getHookTrustRequest(pending.request.id)?.status).toBe('allowed')
    expect(db.getAgentTurnCheckpoint(turn.turnID)).toMatchObject({
      state: 'ready',
      payload: { kind: 'hook-trust', requestID: pending.request.id, decision: 'allow' },
    })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
    recoverInterruptedRuns(db)
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'hook/trust/resolved'")
        .get(),
    ).toEqual({ count: 1 })
  })

  test('Question timer 在 resolve 与 pending probe 同时失败时仍按退避重试', async () => {
    let attempts = 0
    let probes = 0
    const scheduler = new QuestionAutoResolutionScheduler({
      isPending: () => {
        probes += 1
        if (probes === 1) throw new Error('database busy')
        return true
      },
      retryDelaysMs: [1, 2, 3],
    })
    scheduler.track({
      id: 'question:retry',
      deadline: Date.now(),
      resolve: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('database busy')
      },
    })
    const deadline = Date.now() + 250
    while (attempts < 3 && Date.now() < deadline) await Bun.sleep(5)
    expect(attempts).toBe(3)
    scheduler.dispose()
  })

  test('Question durable resolution 后 live publish 失败仍恢复 continuation', async () => {
    const { db, thread, turn } = setup()
    db.claimTurnExecution(turn.turnID)
    const hub = await Effect.runPromise(EventHub.make)
    const creator = new QuestionService(db, hub)
    const id = await creator.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: 'clarification',
      question: '继续？',
      options: ['继续', '停止'],
      checkpoint: { state: 'state', interruption: { call: 'question' } },
    })
    const failingHub = {
      publish: () => Effect.fail(new Error('subscriber unavailable')),
    } as unknown as EventHub
    const questions = new QuestionService(db, failingHub, false)
    let resumed = false
    questions.setResumeHandler(() => {
      resumed = true
    })
    await questions.reply(id, '继续')
    expect(resumed).toBe(true)
    expect(db.repositories.interactions.pendingQuestionVersion(id)?.status).toBe('resolved')
    const resolvedEvents = (
      db.sqlite
        .query(
          "SELECT COUNT(*) AS count FROM events WHERE method = 'interaction/resolved' AND turn_id = ?",
        )
        .get(turn.turnID) as { count: number }
    ).count
    await expect(questions.reply(id, '重复回答')).rejects.toThrow()
    expect(
      db.sqlite
        .query(
          "SELECT COUNT(*) AS count FROM events WHERE method = 'interaction/resolved' AND turn_id = ?",
        )
        .get(turn.turnID),
    ).toEqual({ count: resolvedEvents })
    creator.dispose()
    questions.dispose()
  })

  test('StartupRecoveryCoordinator 固定阶段顺序且 fatal error 阻止后续 ready 阶段', async () => {
    const order: string[] = []
    const coordinator = new StartupRecoveryCoordinator({
      recoverInterruptedRuns: () => {
        order.push('interrupted')
      },
      discardRecoveredSideChats: () => {
        order.push('side-chats')
      },
      recoverResumeLeases: () => {
        order.push('leases')
      },
      restoreQuestionTimers: () => {
        order.push('questions')
      },
      recoverSubagents: () => {
        order.push('subagents')
      },
      recoverHandoffs: () => {
        order.push('handoffs')
      },
      recoverForks: () => {
        order.push('forks')
      },
      recoverThreadWorktrees: () => {
        order.push('thread-worktrees')
      },
      recoverAutomations: () => {
        order.push('automations')
      },
      startQueues: () => {
        order.push('queues')
      },
    })
    await coordinator.run()
    expect(order).toEqual([
      'interrupted',
      'side-chats',
      'leases',
      'questions',
      'subagents',
      'handoffs',
      'forks',
      'thread-worktrees',
      'automations',
      'queues',
    ])

    const fatalOrder: string[] = []
    const fatal = new StartupRecoveryCoordinator({
      recoverInterruptedRuns: () => {
        fatalOrder.push('interrupted')
      },
      discardRecoveredSideChats: () => undefined,
      recoverResumeLeases: () => {
        throw new Error('invariant')
      },
      restoreQuestionTimers: () => {
        fatalOrder.push('questions')
      },
      recoverSubagents: () => undefined,
      recoverHandoffs: () => undefined,
      recoverForks: () => undefined,
      recoverThreadWorktrees: () => undefined,
      recoverAutomations: () => undefined,
      startQueues: () => {
        fatalOrder.push('queues')
      },
    })
    await expect(fatal.run()).rejects.toThrow('invariant')
    expect(fatalOrder).toEqual(['interrupted'])
  })

  test('Last-Event-ID 只校验诊断值，不推进 acknowledged cursor', () => {
    const { db } = setup()
    const event = db.insertEvent(null, null, 'thread/created', { thread: null })
    const registry = new EventSubscriptionRegistry(db)
    const created = registry.subscribe('connection', {
      streams: [{ streamId: 'global', after: 0 }],
    })
    const subscription = registry.get(created.subscriptionId, 'connection')!
    registry.validateLastEventID(subscription, String(event.id))
    expect(subscription.acknowledged.get('global')).toBe(0)
    expect(() => registry.validateLastEventID(subscription, String(event.id + 1))).toThrow()
    expect(() => registry.validateLastEventID(subscription, '1.5')).toThrow()

    const firstThread = db.createThread('first')
    const secondThread = db.createThread('second')
    const firstLow = (
      db.sqlite
        .query('SELECT MIN(id) AS low FROM events WHERE thread_id = ?')
        .get(firstThread.id) as { low: number }
    ).low
    const scoped = registry.subscribe('connection', {
      streams: [{ streamId: firstThread.id, after: firstLow - 1 }],
    })
    const wrongScope = db.insertEvent(secondThread.id, null, 'thread/updated', {
      thread: { id: secondThread.id },
    })
    expect(() =>
      registry.validateLastEventID(
        registry.get(scoped.subscriptionId, 'connection')!,
        String(wrongScope.id),
      ),
    ).toThrow('不属于当前 stream')
  })

  test('snapshot、history 与 queue 的 projection/streamPosition 使用同一 read fence', () => {
    const path = join(tmpdir(), `pidex-read-fence-${crypto.randomUUID()}.sqlite`)
    const reader = new AgentDatabase(path)
    const writer = new AgentDatabase(path)
    databases.push(reader, writer)
    const thread = reader.createThread()
    const baseInput = {
      content: 'base',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    reader.createTurn(thread.id, baseInput)

    for (const view of ['snapshot', 'history', 'queue'] as const) {
      let concurrentTurnID = ''
      const repository = new ThreadReadViewRepository(reader, {
        afterProjectionRead: (current) => {
          if (current !== view || concurrentTurnID) return
          concurrentTurnID = writer.createTurn(thread.id, {
            ...baseInput,
            content: `concurrent:${view}`,
          }).turnID
        },
      })
      const result =
        view === 'snapshot'
          ? repository.snapshot(thread.id)
          : view === 'history'
            ? repository.history(thread.id, { limit: 100 })
            : repository.queue(thread.id)
      const projectedTurns = 'snapshot' in result ? result.snapshot.turns : result.turns
      expect(
        projectedTurns.some(
          (turn) => ('turn' in turn ? turn.turn.id : turn.id) === concurrentTurnID,
        ),
      ).toBe(false)
      const latest = writer.sqlite.query('SELECT MAX(id) AS sequence FROM events').get() as {
        sequence: number
      }
      expect(result.streamPosition.sequence).toBeLessThan(latest.sequence)
    }
  })

  test('重复 continuation 不会释放正在运行的同 turn coordinator handle', () => {
    const { db, thread } = setup()
    const questions = { setResumeHandler: () => undefined }
    const subagents = {
      setParentResumeHandler: () => undefined,
      collaboration: { saved: () => null },
    }
    const resolver = { acquire: () => null, complete: () => true }
    const service = new ThreadService(
      db,
      null as never,
      null as never,
      null as never,
      questions as never,
      null as never,
      subagents as never,
      null as never,
      { dataRoot: '', userHome: '' },
      null as never,
      null as never,
      null as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver as never,
      false,
    )
    const turn = db.createTurn(thread.id, {
      content: 'race',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    })
    let starts = 0
    Object.defineProperty(db, 'startTurnExecution', {
      configurable: true,
      value: () => {
        starts += 1
        return starts === 1 ? { agent: db.agentForTurn(turn.turnID)!, events: [] } : null
      },
    })
    Object.defineProperty(service, 'publish', {
      configurable: true,
      value: () => new Promise<void>(() => undefined),
    })
    const internal = service as unknown as {
      executeTurn(threadID: string, turnID: string): Promise<void>
      coordinator: { active(threadID: string): { turnID: string } | undefined }
    }
    void internal.executeTurn(thread.id, turn.turnID)
    void internal.executeTurn(thread.id, turn.turnID)
    expect(starts).toBe(2)
    expect(internal.coordinator.active(thread.id)?.turnID).toBe(turn.turnID)
  })
})
