import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { Schema } from 'effect'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFile, mkdtemp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { Model, Provider } from '@pidex/model-schema'
import { EventManifest } from '@pidex/agent-protocol'
import { removeFixturePaths } from './FixtureCleanup'
import type { ToolInvocation } from '../src/Domain'
import { ApprovalService } from '../src/permission/ApprovalService'
import { QuestionService } from '../src/session/QuestionService'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { SqlitePiSessionRepo } from '../src/storage/pi-session/SqlitePiSession'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'
import { EventHub } from '../src/storage/events/EventHub'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { pausedSubagentStatus } from '../src/subagent/SubagentService'
import { InteractionService } from '../src/interaction/InteractionService'
import {
  ResumeCheckpointResolver,
  toPlanCheckpoint,
} from '../src/interaction/ResumeCheckpointResolver'
import {
  ApprovalRules,
  simpleCommandArgv,
  commandPrefixMatches,
} from '../src/permission/ApprovalRules'
import { ConfigService } from '../src/config/ConfigService'
import { McpElicitationService } from '../src/mcp/McpElicitationService'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import { AgentRuntimeService } from '../src/orchestration/AgentRuntimeService'
import { ContextCompactionService } from '../src/context/ContextCompactionService'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { ReviewerService } from '../src/permission/ReviewerService'
import type { PiModelService } from '../src/provider/pi'

const paths: string[] = []
const databases: AgentDatabase[] = []
const configs: ConfigService[] = []
afterEach(async () => {
  for (const config of configs.splice(0)) await config.dispose()
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
}, 30_000)

const setup = (db: AgentDatabase, projectID?: string, taskMode: 'chat' | 'plan' = 'chat') => {
  const thread = db.createThread('审批', projectID)
  const input = {
    content: '执行命令',
    model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
    },
    strategy: 'queue',
    taskMode,
  } as const
  const turn = db.createTurn(thread.id, input)
  db.claimTurnExecution(turn.turnID)
  return { thread, turn, input }
}

async function scopedFixture(taskMode: 'chat' | 'plan' = 'chat') {
  const root = await mkdtemp(join(tmpdir(), 'cpx-scoped-approval-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  databases.push(db)
  const workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.pidex'), { recursive: true })
  const projectFile = join(workspace, '.pidex', 'config.json')
  await writeFile(projectFile, '{ "future_key": { "keep": true } }\n', 'utf8')
  const config = new ConfigService(join(root, 'config.json'))
  configs.push(config)
  await config.initialize()
  await config.trustUpdate(workspace, 'trusted')
  const project = db.createProject({ rootPath: workspace })
  const { thread, turn, input } = setup(db, project.id, taskMode)
  const hub = await Effect.runPromise(EventHub.make)
  const tools = new ToolRegistry()
  const invocation: ToolInvocation = {
    id: crypto.randomUUID(),
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    name: 'PowerShell',
    input: { command: 'git status', cwd: workspace },
    permissionConfig: input.permissionConfig,
    model: input.model,
    taskMode,
    durableApproval: true,
  }
  return { db, hub, tools, config, project, projectFile, workspace, thread, turn, invocation }
}

describe('harness ready 与审批恢复期间的 steer', () => {
  for (const mode of ['startup', 'live-tool', 'approval-resume'] as const) {
    const approvalResume = mode === 'approval-resume'
    test(`${mode} 接受的追加交给当前运行 harness 且只消费一次`, async () => {
      const {
        db,
        hub,
        tools,
        config,
        workspace: root,
        thread,
        turn,
        invocation,
      } = await scopedFixture()
      const approvals = new ApprovalService(db, hub, tools, null, config)
      const workspace = await WorkspaceService.open(root)
      const target = join(root, 'once.txt')
      let writes = 0
      let enter!: () => void
      let release!: () => void
      const entered = new Promise<void>((resolve) => {
        enter = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const executor = new ToolExecutor(tools, {
        dataDir: join(root, '..', 'agent-data'),
        authorizeShell: (input, signal) => approvals.authorize(input, signal),
        resolvePermissionRules: (input) => approvals.rules.evaluate(input),
        recordToolCall: (input, status, output, error, startedAt) =>
          db.upsertToolCall(input, status, output, error, startedAt),
        runHost: async () => {
          enter()
          await gate
          writes++
          await appendFile(target, 'ONLY-WRITE\n', 'utf8')
          return {
            stdout: 'ONLY-WRITE',
            stderr: '',
            exitCode: 0,
            signal: null,
            timedOut: false,
            truncated: false,
          }
        },
      })
      const faux = fauxProvider({
        models: [{ id: 'steer-ready', input: ['text'], contextWindow: 64_000 }],
      })
      const models = createModels()
      models.setProvider(faux.provider)
      const runtime = new AgentRuntimeService({
        db,
        hub,
        models,
        toolExecutor: executor,
        contextCompaction: new ContextCompactionService(db),
      })
      const request = {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        sessionID: db.getAgentExecution(turn.agentID)!.sessionID,
        content: 'original request',
        taskMode: 'chat' as const,
        fallbackModel: invocation.model,
        permissionConfig: invocation.permissionConfig,
        signal: new AbortController().signal,
        workspace,
        promptSections: [],
        resolveModel: async () => ({ ref: invocation.model, model: faux.getModel() }),
        pause: async (
          pending: import('../src/orchestration/AgentRuntimeTypes').PendingApproval,
        ) => {
          await approvals.attachRunState(
            pending.toolCallID!,
            pending.checkpoint.state,
            pending.checkpoint.interruption,
          )
        },
      }
      const guideId = 'steer-during-tool'
      const addGuide = () =>
        db.appendGuide(
          thread.id,
          turn.turnID,
          { ...invocation, content: 'STEER-MARKER', strategy: 'guide' as const },
          guideId,
        )
      let ready = 0
      const onRuntimeReady = async () => {
        ready++
        for (const guide of db.guideMailbox(turn.turnID))
          await runtime.steer(thread.id, guide.content, [], guide.id)
      }
      const call = fauxToolCall('PowerShell', {
        command: 'curl.exe -I https://example.com',
        cwd: root,
      })
      try {
        let resume: import('../src/orchestration/AgentRuntimeTypes').AgentRuntimeRequest['resume']
        if (approvalResume) {
          faux.setResponses([fauxAssistantMessage(call, { stopReason: 'toolUse' })])
          expect(await runtime.run(request)).toMatchObject({ status: 'paused' })
          expect(writes).toBe(0)
          const checkpoint = db.approvalCheckpointForToolCall(call.id)!
          await approvals.respond(checkpoint.approvalID, 'allow')
          const acquired = new ResumeCheckpointResolver(db, approvals).acquire(
            turn.turnID,
            'main',
            'steer-resume-lease',
          )!
          if (acquired.checkpoint.kind !== 'permission') throw new Error('Expected approval resume')
          resume = toPlanCheckpoint({ leaseID: acquired.leaseID, checkpoint: acquired.checkpoint })
        } else if (mode === 'startup') addGuide()
        if (mode === 'live-tool')
          await approvals.rules.upsert(thread.id, {
            effect: 'allow',
            scope: 'chat',
            match: { kind: 'tool', tool: 'PowerShell' },
          })
        faux.setResponses([
          ...(mode === 'live-tool' ? [fauxAssistantMessage(call, { stopReason: 'toolUse' })] : []),
          (context) => {
            expect(JSON.stringify(context.messages)).toContain('STEER-MARKER')
            if (mode !== 'startup') {
              const results = context.messages.filter(
                (message) => message.role === 'toolResult' && message.toolCallId === call.id,
              )
              expect(results).toHaveLength(1)
            }
            return fauxAssistantMessage('STEER-CONSUMED-OK')
          },
        ])
        const running = runtime.run({ ...request, ...(resume ? { resume } : {}), onRuntimeReady })
        if (mode !== 'startup') {
          await entered
          addGuide()
          expect(db.guideMailbox(turn.turnID).map((input) => input.id)).toEqual([guideId])
          expect(ready).toBe(approvalResume ? 0 : 1)
          if (!approvalResume) await runtime.steer(thread.id, 'STEER-MARKER', [], guideId)
          release()
        }
        expect(await running).toMatchObject({ status: 'completed', output: 'STEER-CONSUMED-OK' })
        expect(ready).toBe(1)
        expect(db.guideMailbox(turn.turnID)).toEqual([])
        expect(db.sqlite.query('SELECT status FROM inputs WHERE id=?').get(guideId)).toEqual({
          status: 'consumed',
        })
        expect(
          db.sqlite
            .query(
              "SELECT count(*) AS n FROM events WHERE turn_id=? AND method='queue/updated' AND json_extract(params,'$.action')='steer-consumed' AND json_extract(params,'$.inputId')=?",
            )
            .get(turn.turnID, guideId),
        ).toEqual({ n: 1 })
        if (mode !== 'startup') {
          expect(writes).toBe(1)
          expect(await readFile(target, 'utf8')).toBe('ONLY-WRITE\n')
          expect(
            db.sqlite
              .query(
                "SELECT count(*) AS n FROM events WHERE turn_id=? AND method='tool/callCompleted'",
              )
              .get(turn.turnID),
          ).toEqual({ n: 1 })
        }
      } finally {
        release()
        await runtime.dispose()
      }
    })
  }
})

describe('提问重启的工具结果一致性', () => {
  test.each(['pending', 'resolved', 'stopped', 'invalid-checkpoint', 'nested-checkpoint'] as const)(
    '真实问题 checkpoint 在 %s 时重启，保留可恢复工具且只完成一次',
    async (stage) => {
      const fixture = await scopedFixture('plan')
      const { hub, tools, config, workspace: root, thread, turn, invocation } = fixture
      let db = fixture.db
      let questions = new QuestionService(db, hub)
      const faux = fauxProvider({
        models: [{ id: 'question-recovery', input: ['text'], contextWindow: 64_000 }],
      })
      const models = createModels()
      models.setProvider(faux.provider)
      const createRuntime = () =>
        new AgentRuntimeService({
          db,
          hub,
          models,
          toolExecutor: new ToolExecutor(tools, {
            dataDir: join(root, '..', 'agent-data'),
            authorizeShell: async () => {
              throw new Error('提问恢复测试不应执行 Shell')
            },
          }),
          contextCompaction: new ContextCompactionService(db),
        })
      let runtime = createRuntime()
      const call = fauxToolCall('request_user_input', {
        questions: [
          {
            id: 'route',
            header: '路线',
            question: '选择路线？',
            options: [
              { label: 'Alpha', description: '第一条路线' },
              { label: 'Beta', description: '第二条路线' },
            ],
          },
        ],
      })
      const request = {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        sessionID: db.getAgentExecution(turn.agentID)!.sessionID,
        content: '确认路线',
        taskMode: 'plan' as const,
        fallbackModel: invocation.model,
        permissionConfig: invocation.permissionConfig,
        signal: new AbortController().signal,
        workspace: await WorkspaceService.open(root),
        promptSections: [],
        resolveModel: async () => ({ ref: invocation.model, model: faux.getModel() }),
        pause: async (
          pending: import('../src/orchestration/AgentRuntimeTypes').PendingApproval,
        ) => {
          await questions.checkpoint(thread.id, turn.turnID, turn.agentID, pending)
        },
      }
      try {
        faux.setResponses([fauxAssistantMessage([call])])
        expect(await runtime.run(request)).toMatchObject({ status: 'paused' })
        const pending = db.pendingQuestions(thread.id)[0]!
        expect(db.repositories.interactions.questionToolCallID(pending.id)).toBe(call.id)
        const answer = [{ questionId: 'route', choiceIds: [], text: 'FREEFORM-RECOVERED' }]
        db.upsertItem(thread.id, {
          id: 'unrelated-question-tool',
          turnID: turn.turnID,
          agentID: turn.agentID,
          type: 'tool',
          status: 'running',
          data: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        if (stage === 'resolved') await questions.reply(pending.id, answer, false, 'user', false)
        if (stage === 'invalid-checkpoint')
          db.sqlite
            .query(
              "UPDATE question_requests SET payload = json_remove(payload, '$.checkpoint') WHERE id = ?",
            )
            .run(pending.id)
        if (stage === 'nested-checkpoint')
          db.sqlite
            .query(
              "UPDATE question_requests SET payload = json_set(payload, '$.checkpoint', json_object('payload', json_extract(payload, '$.checkpoint'))) WHERE id = ?",
            )
            .run(pending.id)
        if (stage === 'stopped') {
          questions.cancelTurn(turn.turnID)
          db.updateTurnStatus(turn.turnID, 'interrupted')
          db.updateAgentStatus(turn.agentID, 'interrupted')
        }
        await runtime.dispose()
        questions.dispose()
        db.close()
        db = new AgentDatabase(join(root, '..', 'history.sqlite'))
        databases.push(db)
        recoverInterruptedRuns(db)
        questions = new QuestionService(db, hub)
        runtime = createRuntime()
        const approvals = new ApprovalService(db, hub, tools, null, config)
        const resolver = new ResumeCheckpointResolver(db, approvals)
        expect(db.getItem('unrelated-question-tool')?.status).toBe('interrupted')
        if (stage === 'stopped') {
          expect(db.getItem(call.id)?.status).toBe('interrupted')
          expect(db.repositories.interactions.pendingQuestionVersion(pending.id)?.status).toBe(
            'cancelled',
          )
          await expect(questions.reply(pending.id, answer)).rejects.toThrow()
          expect(resolver.acquire(turn.turnID, 'main', crypto.randomUUID())).toBeNull()
          return
        }
        if (stage === 'invalid-checkpoint') {
          expect(db.getItem(call.id)?.status).toBe('interrupted')
          expect(resolver.acquire(turn.turnID, 'main', crypto.randomUUID())).toBeNull()
          return
        }
        expect(db.getItem(call.id)?.status).toBe('running')
        if (stage !== 'resolved') await questions.reply(pending.id, answer, false, 'user', false)
        const acquired = resolver.acquire(turn.turnID, 'main', crypto.randomUUID())!
        expect(acquired.checkpoint.kind).toBe('question')
        if (acquired.checkpoint.kind !== 'question') throw new Error('expected question lease')
        const resume = toPlanCheckpoint({ ...acquired, checkpoint: acquired.checkpoint })
        faux.setResponses([
          (context) => {
            const results = context.messages.filter(
              (message) => message.role === 'toolResult' && message.toolCallId === call.id,
            )
            expect(results).toHaveLength(1)
            expect(JSON.stringify(results)).toContain('FREEFORM-RECOVERED')
            expect(JSON.stringify(results)).not.toContain('__piPause')
            return fauxAssistantMessage('确认 FREEFORM-RECOVERED')
          },
        ])
        expect(await runtime.run({ ...request, resume })).toMatchObject({ status: 'completed' })
        expect(resolver.complete(resume.resumeLeaseID!)).toBe(true)
        expect(db.getItem(call.id)).toMatchObject({
          status: 'completed',
          data: { error: null, output: expect.stringContaining('FREEFORM-RECOVERED') },
        })
        expect(db.repositories.interactions.pendingQuestionVersion(pending.id)?.status).toBe(
          'consumed',
        )
        const events = db.sqlite
          .query(
            "SELECT method, count(*) AS n FROM events WHERE turn_id = ? AND method IN ('tool/callCompleted','tool/error','interaction/resolved') GROUP BY method ORDER BY method",
          )
          .all(turn.turnID)
        expect(events).toEqual([
          { method: 'interaction/resolved', n: 1 },
          { method: 'tool/callCompleted', n: 1 },
        ])
        recoverInterruptedRuns(db)
        expect(resolver.acquire(turn.turnID, 'main', crypto.randomUUID())).toBeNull()
        await expect(questions.reply(pending.id, answer)).rejects.toThrow()
        expect(db.getItem(call.id)?.status).toBe('completed')
        expect(
          db.sqlite
            .query(
              "SELECT count(*) AS n FROM events WHERE turn_id = ? AND method = 'tool/callCompleted'",
            )
            .get(turn.turnID),
        ).toEqual({ n: 1 })
      } finally {
        questions.dispose()
        await runtime.dispose()
      }
    },
  )
})

describe('审批范围与外部交互', () => {
  test('真实 Guardian 10 秒超时转人工，批准后原命令只执行一次且不重复审查', async () => {
    const {
      db,
      hub,
      tools,
      config,
      workspace: root,
      thread,
      turn,
      invocation,
    } = await scopedFixture()
    let reviewCalls = 0
    let reviewAborted = false
    const providers = {
      getPiModel: async () => ({ provider: 'openai', id: 'test' }),
      pi: {
        completeSimple: async (
          _model: unknown,
          _context: unknown,
          options: { signal: AbortSignal },
        ) => {
          reviewCalls++
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                reviewAborted = true
                reject(options.signal.reason)
              },
              { once: true },
            )
          })
        },
      },
    } as unknown as PiModelService
    const reviewer = new ReviewerService(db, providers, config)
    const service = new ApprovalService(
      db,
      hub,
      tools,
      (value, signal) => reviewer.review(value, signal),
      config,
    )
    let executions = 0
    const executor = new ToolExecutor(tools, {
      dataDir: join(root, '..', 'agent-data'),
      authorizeShell: (value, signal) => service.authorize(value, signal),
      resolvePermissionRules: (value) => service.rules.evaluate(value),
      runHost: async () => {
        executions++
        return {
          stdout: 'approved',
          stderr: '',
          exitCode: 0,
          signal: null,
          timedOut: false,
          truncated: false,
        }
      },
    })
    const context = {
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      taskMode: 'chat' as const,
      signal: new AbortController().signal,
      workspace: await WorkspaceService.open(root),
      model: invocation.model,
      permissionConfig: {
        ...invocation.permissionConfig,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'auto_review' as const,
      },
    }
    const input = { command: 'curl.exe -I https://example.com', cwd: root }
    const decision = await executor.previewApproval('PowerShell', input, context, 'real-timeout')
    expect(reviewCalls).toBe(1)
    expect(reviewAborted).toBe(true)
    expect(executions).toBe(0)
    expect(decision).toMatchObject({
      decision: 'ask',
      guardian: { status: 'timeout', source: 'fallback' },
    })
    await service.attachRunState('real-timeout', '{"engine":"pi"}', { toolCallID: 'real-timeout' })
    const checkpoint = db.approvalCheckpointForToolCall('real-timeout')!
    expect(checkpoint.status).toBe('pending')
    expect(db.repositories.interactions.approvalReviewState(thread.id).reviews[0]).toMatchObject({
      decision: 'ask',
      guardian: { status: 'timeout' },
    })
    await service.respond(checkpoint.approvalID, 'allow')
    const output = await executor.execute('PowerShell', input, {
      ...context,
      toolCallID: 'real-timeout',
      approvedToolCallID: 'real-timeout',
      ...(decision.authorizationFingerprint
        ? { approvedAuthorizationFingerprint: decision.authorizationFingerprint }
        : {}),
    })
    expect(output).toMatchObject({ stdout: 'approved', exitCode: 0 })
    expect(executions).toBe(1)
    expect(reviewCalls).toBe(1)
  }, 20_000)

  for (const unavailable of ['missing', 'error'] as const) {
    test(`Guardian ${unavailable} 时联网调用转可恢复人工审批`, async () => {
      const { db, hub, tools, config, invocation } = await scopedFixture()
      const service = new ApprovalService(
        db,
        hub,
        tools,
        unavailable === 'missing'
          ? null
          : async () => {
              throw new Error('reviewer unavailable')
            },
        config,
      )
      const network = {
        ...invocation,
        input: { ...invocation.input, command: 'curl.exe -I https://example.com' },
        permissionConfig: {
          ...invocation.permissionConfig,
          approvalPolicy: 'on-request' as const,
          approvalsReviewer: 'auto_review' as const,
        },
        permissionFacts: { risk: 'medium' as const, networkAccess: true },
      }
      expect(await service.authorize(network, new AbortController().signal)).toMatchObject({
        decision: 'ask',
      })
      await service.attachRunState(network.id, '{"engine":"pi"}', { toolCallID: network.id })
      const checkpoint = db.approvalCheckpointForToolCall(network.id)!
      expect(checkpoint.status).toBe('pending')
      expect(
        (await service.respond(checkpoint.approvalID, 'allow')).payload.resolution?.decision,
      ).toBe('allow')
    })
  }

  for (const name of ['Write', 'PowerShell'] as const) {
    for (const scope of ['once', 'session', 'project'] as const) {
      test(`${name} ${scope} 审批暂停后只执行一次，等待结果不能冒充完成结果`, async () => {
        const {
          db,
          hub,
          tools,
          config,
          workspace: root,
          thread,
          turn,
          invocation,
        } = await scopedFixture()
        if (scope === 'project') await unlink(join(root, '.pidex', 'config.json'))
        const service = new ApprovalService(db, hub, tools, null, config)
        const workspace = await WorkspaceService.open(root)
        const target = join(root, '..', 'approved.txt')
        const call = fauxToolCall(
          name,
          name === 'Write'
            ? { file_path: target, content: 'approved' }
            : { command: 'curl.exe -I https://example.com', cwd: root },
        )
        let executions = 0
        const executor = new ToolExecutor(tools, {
          dataDir: join(root, '..', 'agent-data'),
          authorizeShell: (input, signal) => service.authorize(input, signal),
          resolvePermissionRules: (input) => service.rules.evaluate(input),
          recordToolCall: (input, status, output, error, startedAt) => {
            if (status === 'running') executions++
            db.upsertToolCall(input, status, output, error, startedAt)
          },
          runHost: async () => ({
            stdout: 'HTTP/1.1 200 OK',
            stderr: '',
            exitCode: 0,
            signal: null,
            timedOut: false,
            truncated: false,
          }),
        })
        const faux = fauxProvider({
          models: [{ id: 'approval-test', input: ['text'], contextWindow: 64_000 }],
        })
        const models = createModels()
        models.setProvider(faux.provider)
        const runtime = new AgentRuntimeService({
          db,
          hub,
          models,
          toolExecutor: executor,
          contextCompaction: new ContextCompactionService(db),
        })
        const request = {
          threadID: thread.id,
          turnID: turn.turnID,
          agentID: turn.agentID,
          sessionID: db.getAgentExecution(turn.agentID)!.sessionID,
          content: 'execute exactly once',
          taskMode: 'chat' as const,
          fallbackModel: invocation.model,
          permissionConfig: {
            ...invocation.permissionConfig,
            approvalPolicy: 'on-request' as const,
          },
          signal: new AbortController().signal,
          workspace,
          promptSections: [],
          resolveModel: async () => ({ ref: invocation.model, model: faux.getModel() }),
          pause: async (
            pending: import('../src/orchestration/AgentRuntimeTypes').PendingApproval,
          ) => {
            await service.attachRunState(
              pending.toolCallID!,
              pending.checkpoint.state,
              pending.checkpoint.interruption,
            )
          },
        }
        faux.setResponses([
          fauxAssistantMessage(call, { stopReason: 'toolUse' }),
          () => {
            throw new Error('审批暂停期间不能继续请求模型')
          },
        ])
        try {
          expect(await runtime.run(request)).toMatchObject({ status: 'paused' })
          expect(executions).toBe(0)
          expect(
            db.sqlite
              .query(
                "SELECT COUNT(*) AS count FROM events WHERE turn_id = ? AND method = 'tool/error'",
              )
              .get(turn.turnID),
          ).toEqual({ count: 0 })
          expect(db.hasPersistedToolResult(turn.turnID, call.id)).toBe(false)
          const checkpoint = db.approvalCheckpointForToolCall(call.id)!
          const option = service.rules
            .options(checkpoint.payload.invocation)
            .find((value) => value.scope === scope)
          if (scope !== 'once') expect(option).toBeDefined()
          if (name === 'PowerShell')
            expect(
              checkpoint.payload.invocation.permissionFacts?.ruleTargets?.networkDomains,
            ).toEqual(['example.com'])
          await service.respond(
            checkpoint.approvalID,
            'allow',
            undefined,
            undefined,
            undefined,
            option?.id,
          )
          if (scope !== 'once')
            expect((await service.rules.list(thread.id)).rules.length).toBeGreaterThan(0)
          faux.setResponses([
            (context) => {
              const transcript = JSON.stringify(context.messages)
              expect(transcript).toContain('新的 toolCallId 并重新判权')
              expect(transcript).toContain('不得重复执行该 ID')
              expect(transcript).toContain('不得自行换工具或等价命令绕过用户拒绝')
              return fauxAssistantMessage('done')
            },
          ])
          const resume = {
            state: checkpoint.payload.runState!,
            interruption: checkpoint.payload.interruption,
            answer: null,
            decision: 'allow' as const,
            toolCallID: call.id,
            ...(checkpoint.payload.invocation.authorizationScope?.fingerprint
              ? {
                  authorizationFingerprint:
                    checkpoint.payload.invocation.authorizationScope.fingerprint,
                }
              : {}),
          }
          await runtime.run({ ...request, resume })
          expect(executions).toBe(1)
          expect(
            db.sqlite.query('SELECT status, error FROM tool_calls WHERE id = ?').get(call.id),
          ).toMatchObject({ status: 'completed', error: null })
          expect(db.hasPersistedToolResult(turn.turnID, call.id)).toBe(true)
          if (name === 'Write') expect(await readFile(target, 'utf8')).toBe('approved')
          else
            expect(db.completedToolCall(call.id)?.output).toMatchObject({
              stdout: 'HTTP/1.1 200 OK',
            })
          faux.setResponses([fauxAssistantMessage('already done')])
          await runtime.run({ ...request, resume })
          expect(executions).toBe(1)
        } finally {
          await runtime.dispose()
        }
      })
    }
  }

  test.each([
    ['in-order', 'allow', 'deny'],
    ['reverse', 'deny', 'allow'],
    ['resolved-together', 'allow', 'allow'],
    ['stop-after-first', 'allow', 'deny'],
    ['restart-before-first', 'allow', 'deny'],
    ['restart-before-first-deny', 'deny', 'allow'],
    ['stopped-before-restart', 'allow', 'deny'],
  ] as const)(
    '同批审批 %s（%s/%s）逐一恢复并保留其他工具结果，全部处理前不请求模型',
    async (order, firstDecision, secondDecision) => {
      const {
        db: initialDB,
        hub,
        tools,
        config,
        workspace: root,
        thread,
        turn,
        invocation,
      } = await scopedFixture()
      let db = initialDB
      let service = new ApprovalService(db, hub, tools, null, config)
      let resolver = new ResumeCheckpointResolver(db, service)
      const workspace = await WorkspaceService.open(root)
      const calls = [
        fauxToolCall('Write', { file_path: join(root, '..', 'first.txt'), content: 'first' }),
        fauxToolCall('Write', { file_path: join(root, '..', 'second.txt'), content: 'second' }),
        fauxToolCall('Read', { file_path: join(root, 'safe.txt') }),
      ]
      await writeFile(join(root, 'safe.txt'), 'SAFE-SIBLING', 'utf8')
      const executions: string[] = []
      const controller = new AbortController()
      const createExecutor = () =>
        new ToolExecutor(tools, {
          dataDir: join(root, '..', 'agent-data'),
          authorizeShell: (input, signal) => service.authorize(input, signal),
          resolvePermissionRules: (input) => service.rules.evaluate(input),
          recordToolCall: (input, status, output, error, startedAt) => {
            if (status === 'running') executions.push(input.id)
            db.upsertToolCall(input, status, output, error, startedAt)
            if (
              order === 'stop-after-first' &&
              status === 'completed' &&
              input.id === calls[0]!.id
            ) {
              controller.abort()
              db.updateTurnStatus(turn.turnID, 'interrupted')
              db.updateAgentStatus(turn.agentID, 'interrupted')
            }
          },
        })
      let executor = createExecutor()
      const faux = fauxProvider({
        models: [{ id: 'batch-approval', input: ['text'], contextWindow: 64_000 }],
      })
      const models = createModels()
      models.setProvider(faux.provider)
      const createRuntime = () =>
        new AgentRuntimeService({
          db,
          hub,
          models,
          toolExecutor: executor,
          contextCompaction: new ContextCompactionService(db),
        })
      let runtime = createRuntime()
      const request = {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        sessionID: db.getAgentExecution(turn.agentID)!.sessionID,
        content: 'batch approval',
        taskMode: 'chat' as const,
        fallbackModel: invocation.model,
        permissionConfig: { ...invocation.permissionConfig, approvalPolicy: 'on-request' as const },
        signal: controller.signal,
        workspace,
        promptSections: [],
        resolveModel: async () => ({ ref: invocation.model, model: faux.getModel() }),
        pause: async (
          pending: import('../src/orchestration/AgentRuntimeTypes').PendingApproval,
        ) => {
          await service.attachRunState(
            pending.toolCallID!,
            pending.checkpoint.state,
            pending.checkpoint.interruption,
          )
        },
      }
      const restart = async () => {
        await runtime.dispose()
        db.close()
        db = new AgentDatabase(join(root, '..', 'history.sqlite'))
        databases.push(db)
        recoverInterruptedRuns(db)
        service = new ApprovalService(db, hub, tools, null, config)
        resolver = new ResumeCheckpointResolver(db, service)
        executor = createExecutor()
        runtime = createRuntime()
      }
      const assertResults = async () => {
        const session = await new SqlitePiSessionRepo(db).openByID(request.sessionID)
        const branch = await session.getBranch()
        const branchResults = branch.flatMap((entry) =>
          entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message] : [],
        )
        for (const call of calls) {
          expect(branchResults.filter((result) => result.toolCallId === call.id)).toHaveLength(1)
          const denied = db.approvalCheckpointForToolCall(call.id)?.decision === 'deny'
          expect(db.getItem(call.id)).toMatchObject({
            status: denied ? 'error' : 'completed',
            data: denied
              ? { output: null, error: expect.any(String) }
              : { output: expect.any(String), error: null },
          })
          expect(
            db.sqlite
              .query(
                "SELECT COUNT(*) AS count FROM events WHERE turn_id = ? AND method = ? AND json_extract(params, '$.item.id') = ?",
              )
              .get(turn.turnID, denied ? 'tool/error' : 'tool/callCompleted', call.id),
          ).toEqual({ count: 1 })
        }
      }
      faux.setResponses([
        fauxAssistantMessage(calls, { stopReason: 'toolUse' }),
        () => {
          throw new Error('所有审批处理前不能请求模型')
        },
      ])
      try {
        expect(await runtime.run(request)).toMatchObject({ status: 'paused' })
        expect(executions).toEqual([calls[2]!.id])
        const checkpoints = calls
          .slice(0, 2)
          .map((call) => db.approvalCheckpointForToolCall(call.id)!)
        expect(checkpoints.every((checkpoint) => checkpoint.status === 'pending')).toBe(true)
        if (order === 'stopped-before-restart') {
          db.repositories.interactions.finalizeTurn({
            threadID: thread.id,
            turnID: turn.turnID,
            agentID: turn.agentID,
            status: 'interrupted',
            pauseReason: 'interrupted',
          })
          await restart()
          expect(db.getAgentExecution(turn.agentID)?.status).toBe('interrupted')
          expect(resolver.acquire(turn.turnID, 'main', crypto.randomUUID())).toBeNull()
          for (const checkpoint of checkpoints) {
            expect(db.getItem(checkpoint.toolCallID)?.status).toBe('interrupted')
            expect(service.load(checkpoint.approvalID)?.status).toBe('cancelled')
            await expect(service.respond(checkpoint.approvalID, 'allow')).rejects.toThrow()
          }
          expect(executions).toEqual([calls[2]!.id])
          return
        }
        if (order.startsWith('restart-before-first')) {
          db.upsertItem(thread.id, {
            id: 'unrelated-running-tool',
            turnID: turn.turnID,
            agentID: turn.agentID,
            type: 'tool',
            status: 'running',
            data: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          await restart()
          for (const checkpoint of checkpoints)
            expect(db.getItem(checkpoint.toolCallID)?.status).toBe('running')
          expect(db.getItem('unrelated-running-tool')?.status).toBe('interrupted')
        }
        if (order === 'reverse') checkpoints.reverse()
        const first = checkpoints[0]!,
          second = checkpoints[1]!
        await service.respond(first.approvalID, firstDecision)
        if (order === 'resolved-together') await service.respond(second.approvalID, secondDecision)
        const resume = (checkpoint: typeof first) => {
          const acquired = resolver.acquire(turn.turnID, 'main', crypto.randomUUID())!
          expect(acquired.checkpoint.kind).toBe('permission')
          if (acquired.checkpoint.kind !== 'permission') throw new Error('expected approval lease')
          expect(acquired.checkpoint.approvalID).toBe(checkpoint.approvalID)
          return toPlanCheckpoint({ ...acquired, checkpoint: acquired.checkpoint })
        }
        const firstResume = resume(first)
        if (order === 'stop-after-first') {
          await expect(runtime.run({ ...request, resume: firstResume })).rejects.toMatchObject({
            code: 'RUN_ABORTED',
          })
          expect(db.getAgentExecution(turn.agentID)?.status).toBe('interrupted')
          return
        }
        expect(await runtime.run({ ...request, resume: firstResume })).toMatchObject({
          status: 'paused',
        })
        expect(resolver.complete(firstResume.resumeLeaseID!)).toBe(true)
        expect(executions.filter((id) => id === first.toolCallID)).toHaveLength(
          firstDecision === 'allow' ? 1 : 0,
        )
        expect(db.getAgentExecution(turn.agentID)?.status).toBe(
          order === 'resolved-together' ? 'queued' : 'waiting_permission',
        )
        // Reopen storage and recreate execution state to exercise process recovery.
        await restart()
        expect(db.getItem(second.toolCallID)?.status).toBe('running')
        if (order !== 'resolved-together') await service.respond(second.approvalID, secondDecision)
        faux.setResponses([
          (context) => {
            const results = context.messages.filter((message) => message.role === 'toolResult')
            for (const call of calls)
              expect(results.filter((result) => result.toolCallId === call.id)).toHaveLength(1)
            expect(JSON.stringify(results)).toContain('SAFE-SIBLING')
            expect(results.find((result) => result.toolCallId === first.toolCallID)?.isError).toBe(
              firstDecision === 'deny',
            )
            expect(results.find((result) => result.toolCallId === second.toolCallID)?.isError).toBe(
              secondDecision === 'deny',
            )
            expect(JSON.stringify(results)).not.toContain('__piPause')
            return fauxAssistantMessage('done')
          },
        ])
        const lastResume = resume(second)
        expect(await runtime.run({ ...request, resume: lastResume })).toMatchObject({
          status: 'completed',
        })
        expect(resolver.complete(lastResume.resumeLeaseID!)).toBe(true)
        await assertResults()
        expect(executions.filter((id) => id === second.toolCallID)).toHaveLength(
          secondDecision === 'allow' ? 1 : 0,
        )
        expect(db.repositories.interactions.pendingApprovalIDs(thread.id)).toHaveLength(0)
        for (const [checkpoint, decision] of [
          [first, firstDecision],
          [second, secondDecision],
        ] as const) {
          const file = Bun.file(checkpoint.payload.invocation.input.file_path as string)
          expect(await file.exists()).toBe(decision === 'allow')
          if (decision === 'allow')
            expect(await file.text()).toBe(
              checkpoint.toolCallID === calls[0]!.id ? 'first' : 'second',
            )
        }
        faux.setResponses([fauxAssistantMessage('recovered')])
        await runtime.run({ ...request, resume: lastResume })
        await assertResults()
        expect(executions.filter((id) => id === first.toolCallID)).toHaveLength(
          firstDecision === 'allow' ? 1 : 0,
        )
        expect(executions.filter((id) => id === second.toolCallID)).toHaveLength(
          secondDecision === 'allow' ? 1 : 0,
        )
      } finally {
        await runtime.dispose()
      }
    },
  )

  test('持久规则保存失败仍恢复单次允许，不留下聊天白名单', async () => {
    const { db, hub, tools, config, invocation } = await scopedFixture()
    const service = new ApprovalService(db, hub, tools, null, config)
    const mcp: ToolInvocation = {
      ...invocation,
      name: 'mcp_tool',
      input: { value: 'data' },
      toolPolicy: {
        sdkName: 'mcp_tool',
        capabilities: tools.get('PowerShell').capabilities,
        allowedModes: ['chat'],
        approvalStrategy: 'always-review',
        origin: { kind: 'mcp', serverName: 'fixture', rawToolName: 'save', generation: 1 },
      },
    }
    await service.authorize(mcp, new AbortController().signal)
    await service.attachRunState(mcp.id, '{"version":1}', { name: mcp.name, callId: mcp.id })
    const checkpoint = db.approvalCheckpointForToolCall(mcp.id)!
    const option = service.rules.options(mcp).find((value) => value.scope === 'project')!
    service.rules.persistGrant = async () => {
      throw new Error('fixture settings failure')
    }
    await service.respond(
      checkpoint.approvalID,
      'allow',
      undefined,
      undefined,
      undefined,
      option.id,
    )
    expect(db.getApprovalCheckpoint(checkpoint.approvalID)?.status).toBe('resolved')
    expect(await service.rules.matches(mcp)).toBe(false)
    expect(db.getItem(`approval-grant-error:${checkpoint.approvalID}`)?.data.title).toBe(
      '持久授权未保存',
    )
  })

  test('命令前缀按 argv 边界匹配，复杂 Shell 和脚本不提供候选', () => {
    expect(simpleCommandArgv('git status --short')).toEqual(['git', 'status', '--short'])
    expect(simpleCommandArgv('git "status" --short')).toEqual(['git', 'status', '--short'])
    expect(simpleCommandArgv('git "status"foo')).toBeNull()
    expect(simpleCommandArgv('git status"foo"')).toBeNull()
    expect(commandPrefixMatches(['git', 'status'], ['git', 'status-all'])).toBe(false)
    expect(commandPrefixMatches(['git', 'status'], ['git', 'status', '--short'])).toBe(true)
    for (const command of [
      'git status; git clean',
      'git status | cat',
      'git status > result',
      'git status $(pwd)',
      'git status %PATH%',
      'bun run build',
      'bun script.ts',
      'npm test',
      'yarn custom-script',
      'git custom-alias',
      'powershell -File script.ps1',
    ])
      expect(simpleCommandArgv(command)).toBeNull()
  })

  test('聊天命令授权可恢复且隔离 cwd、聊天、额外范围和硬拒绝', async () => {
    const { db, hub, tools, config, project, invocation, workspace } = await scopedFixture()
    const service = new ApprovalService(db, hub, tools, null, config)
    expect((await service.authorize(invocation, new AbortController().signal)).decision).toBe('ask')
    await service.attachRunState(invocation.id, '{"version":1}', {
      name: invocation.name,
      callId: invocation.id,
    })
    const stored = db.approvalCheckpointForToolCall(invocation.id)!
    const grant = service.rules.options(invocation)[0]!
    await service.respond(stored.approvalID, 'allow', undefined, undefined, undefined, grant.id)
    const recovered = new ApprovalService(db, hub, tools, null, config)
    expect(
      (
        await recovered.authorize(
          { ...invocation, id: 'next', input: { command: 'git status', cwd: workspace } },
          new AbortController().signal,
        )
      ).decision,
    ).toBe('allow')
    for (const changed of [
      { ...invocation, input: { command: 'git status-all', cwd: workspace } },
      { ...invocation, input: { command: 'git status --short', cwd: workspace } },
      { ...invocation, input: { command: 'git status', cwd: join(workspace, 'other') } },
      { ...invocation, threadID: db.createThread('另一聊天', project.id).id },
      {
        ...invocation,
        input: { command: 'git status', additionalPermissions: { readPaths: ['C:/secret'] } },
      },
    ])
      expect((await recovered.rules.evaluate(changed)).effect).not.toBe('allow')
    await expect(
      service.respond(stored.approvalID, 'allow', undefined, undefined, undefined, grant.id),
    ).rejects.toThrow('已经处理')
  })

  test('项目 MCP 规则仅匹配特定 server/tool，撤销保留未知配置', async () => {
    const { db, config, tools, project, projectFile, invocation } = await scopedFixture()
    const rules = new ApprovalRules(db, tools, config)
    const mcp = {
      ...invocation,
      name: 'mcp_tool',
      input: { value: 'data' },
      toolPolicy: {
        ...tools.get('PowerShell'),
        origin: { kind: 'mcp' as const, serverName: 'fixture', rawToolName: 'save', generation: 1 },
      },
    }
    const candidate = rules.candidates(mcp).find((rule) => rule.scope === 'project')!
    const { subjects: _subjects, ...legacyCandidate } = candidate
    const grant = { ...legacyCandidate, target: ['fixture', 'save'] }
    const futureRule = { id: grant.id, kind: 'future', target: ['keep'], scope: 'project' }
    await config.batchWrite({
      cwd: grant.workspace,
      target: { kind: 'project' },
      edits: [{ keyPath: ['approval_rules'], value: [futureRule] }],
    })
    await rules.persistProject(grant)
    expect(
      await rules.matches({ ...mcp, threadID: db.createThread('同一项目', project.id).id }),
    ).toBe(true)
    expect(
      await rules.matches({
        ...mcp,
        toolPolicy: {
          ...mcp.toolPolicy,
          origin: { ...mcp.toolPolicy.origin, rawToolName: 'delete' },
        },
      }),
    ).toBe(false)
    expect(await rules.matches({ ...mcp, threadID: db.createThread('无项目').id })).toBe(false)
    expect(await rules.list(mcp.threadID)).toEqual({
      rules: [
        {
          id: grant.id,
          effect: 'allow',
          scope: 'project',
          source: 'legacy',
          match: { kind: 'mcp', server: 'fixture', tool: 'save' },
          editable: true,
        },
      ],
    })
    expect(await rules.revoke(mcp.threadID, grant.id)).toEqual({ revoked: true })
    expect(await rules.matches(mcp)).toBe(false)
    expect(JSON.parse(await readFile(projectFile, 'utf8')).future_key).toEqual({ keep: true })
    expect(JSON.parse(await readFile(projectFile, 'utf8')).approval_rules).toEqual([futureRule])
  })

  test('网络精确域名规则不隐式批准命令前缀、不跨项目、不匹配子域名', async () => {
    const { db, config, tools, invocation, workspace } = await scopedFixture()
    const rules = new ApprovalRules(db, tools, config)
    const network = {
      ...invocation,
      input: {
        command: 'git fetch',
        cwd: workspace,
        additionalPermissions: { networkDomains: ['example.test'] },
      },
    }
    await rules.persistProject({
      id: 'legacy-network',
      kind: 'network',
      scope: 'project',
      workspace,
      target: ['example.test'],
    })
    expect(await rules.matches(network)).toBe(false)
    expect(
      await rules.matches({
        ...network,
        permissionConfig: { ...network.permissionConfig, approvalPolicy: 'on-request' },
      }),
    ).toBe(false)
    expect(
      await rules.matches({
        ...network,
        input: {
          ...network.input,
          additionalPermissions: { networkDomains: ['sub.example.test'] },
        },
      }),
    ).toBe(false)
    const other = db.createProject({ rootPath: join(workspace, 'other') })
    expect(
      await rules.matches({ ...network, threadID: db.createThread('其他项目', other.id).id }),
    ).toBe(false)
  })

  test('自动审查重试仅消费原参数一次，并继续调用 Guardian', async () => {
    const { db, hub, tools, config, invocation } = await scopedFixture()
    const reviewed: ToolInvocation[] = []
    const service = new ApprovalService(
      db,
      hub,
      tools,
      async (value) => {
        reviewed.push(value)
        return { decision: 'deny', risk: 'high', reason: '人工请求重试也需审查' }
      },
      config,
    )
    const automatic = {
      ...invocation,
      permissionConfig: {
        ...invocation.permissionConfig,
        approvalsReviewer: 'auto_review' as const,
      },
    }
    await service.authorize(automatic, new AbortController().signal)
    const denial = db.repositories.interactions.approvalReviewState(invocation.threadID).denials[0]!
    expect(service.requestRetry(invocation.threadID, denial.id, 'retry:1').input).toContain(
      'git status',
    )
    expect(service.requestRetry(invocation.threadID, denial.id, 'retry:1').input).toContain(
      'Guardian',
    )
    expect(
      db.repositories.interactions.approvalReviewState(invocation.threadID).denials[0]
        ?.retryOperationId,
    ).toBe('retry:1')
    expect(
      new ApprovalService(db, hub, tools, null, config).requestRetry(
        invocation.threadID,
        denial.id,
        'retry:1',
      ).input,
    ).toContain('git status')
    await service.authorize(
      { ...automatic, id: 'different', input: { command: 'git diff' } },
      new AbortController().signal,
    )
    expect(reviewed[1]?.retryAuthorization).toBeUndefined()
    expect(
      (await service.authorize({ ...automatic, id: 'retry' }, new AbortController().signal))
        .decision,
    ).toBe('deny')
    expect(reviewed[2]?.retryAuthorization?.reviewId).toBe(denial.id)
    await service.authorize({ ...automatic, id: 'again' }, new AbortController().signal)
    expect(reviewed[3]?.retryAuthorization).toBeUndefined()
    expect(() => service.requestRetry(invocation.threadID, denial.id, 'retry:1')).toThrow('失效')
  })

  test('自动审查连续拒绝后熔断并中断本轮，不再调用 Guardian', async () => {
    const { db, hub, tools, config, invocation } = await scopedFixture()
    const reviewed: ToolInvocation[] = []
    const interrupted: Array<[string, string]> = []
    const service = new ApprovalService(
      db,
      hub,
      tools,
      async (value) => {
        reviewed.push(value)
        return { decision: 'deny', risk: 'high', reason: '自动审查拒绝' }
      },
      config,
    )
    service.setTurnInterruptHandler((threadID, turnID) => interrupted.push([threadID, turnID]))
    const automatic = {
      ...invocation,
      permissionFacts: { ruleRequiresApproval: true },
      permissionConfig: {
        ...invocation.permissionConfig,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'auto_review' as const,
      },
    }
    for (let index = 0; index < 3; index += 1) {
      const result = await service.authorize(
        { ...automatic, id: `denied-${index}` },
        new AbortController().signal,
      )
      expect(result.decision).toBe('deny')
    }
    expect(interrupted).toEqual([[invocation.threadID, invocation.turnID]])
    const reopened = await service.authorize(
      { ...automatic, id: 'circuit-open' },
      new AbortController().signal,
    )
    expect(reopened.decision).toBe('deny')
    expect(reopened.guardian?.status).toBe('circuit_open')
    expect(reviewed).toHaveLength(3)
    expect(interrupted).toHaveLength(1)
    const state = db.repositories.interactions.approvalReviewState(invocation.threadID)
    expect(state.reviews[0]?.guardian.status).toBe('circuit_open')
  })

  test('MCP 表单校验、过期回复、拒绝、断连取消和重启取消分别保留语义', async () => {
    const { db, hub, invocation } = await scopedFixture()
    const service = new McpElicitationService(db, hub)
    const identity = {
      threadID: invocation.threadID,
      turnID: invocation.turnID,
      agentID: invocation.agentID,
      toolCallID: invocation.id,
    }
    const request = {
      message: '输入名称',
      requestedSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    }
    for (const action of ['accept', 'decline', 'cancel'] as const) {
      const controller = new AbortController()
      const promise = service.request(
        'connection:1',
        'fixture',
        'save',
        identity,
        request,
        controller.signal,
      )
      const pending = db.repositories.interactions.pendingMcpElicitations()[0]!
      expect(db.getPendingInteractionCounts(invocation.threadID).approvals).toBe(1)
      await expect(
        service.respond(String(pending.interactionId), 99, {
          kind: 'mcp-elicitation',
          action: 'decline',
        }),
      ).rejects.toThrow('版本')
      if (action === 'accept') {
        await expect(
          service.respond(String(pending.interactionId), 1, {
            kind: 'mcp-elicitation',
            action,
            content: {},
          }),
        ).rejects.toThrow('schema')
        await service.respond(String(pending.interactionId), 1, {
          kind: 'mcp-elicitation',
          action,
          content: { name: 'valid' },
        })
      } else if (action === 'cancel') controller.abort()
      else
        await service.respond(String(pending.interactionId), 1, { kind: 'mcp-elicitation', action })
      expect(await promise).toEqual(
        action === 'accept' ? { action, content: { name: 'valid' } } : { action },
      )
      expect(db.repositories.interactions.pendingMcpElicitations()).toHaveLength(0)
      await expect(
        service.respond(String(pending.interactionId), 1, {
          kind: 'mcp-elicitation',
          action: 'cancel',
        }),
      ).rejects.toThrow('失效')
    }
    db.repositories.interactions.createMcpElicitation(
      {
        interactionId: 'orphan',
        threadId: identity.threadID,
        turnId: identity.turnID,
        agentId: identity.agentID,
        toolCallId: identity.toolCallID,
        kind: 'mcp-elicitation',
        server: 'fixture',
        tool: 'save',
        request,
        version: 1,
        createdAt: Date.now(),
      },
      'lost',
    )
    await new McpElicitationService(db, hub).restore()
    expect(db.repositories.interactions.pendingMcpElicitations()).toHaveLength(0)
    expect(
      db.sqlite.query('SELECT response FROM mcp_elicitations WHERE id = ?').get('orphan'),
    ).toEqual({ response: JSON.stringify({ kind: 'mcp-elicitation', action: 'cancel' }) })
  })

  test('高版本库缺少可选表时隐藏能力并保持库版本', async () => {
    const { db } = await scopedFixture()
    db.sqlite.exec('DROP TABLE mcp_elicitations')
    db.sqlite.exec('DROP TABLE approval_reviews')
    db.sqlite.exec('PRAGMA user_version = 999')
    expect(filterAdvertisedCapabilities(db)).not.toContain('mcp.elicitation.v1')
    expect(filterAdvertisedCapabilities(db)).not.toContain('approval.retry.v1')
    expect(db.repositories.interactions.pendingMcpElicitations()).toEqual([])
    expect(db.repositories.interactions.approvalReviewState(db.createThread().id)).toEqual({
      manualAllows: 0,
      denials: [],
      reviews: [],
    })
    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 999 })
  })
})

describe('可恢复审批 checkpoint', () => {
  test('子 Agent permission pause 不会被覆盖为 waiting_question', () => {
    expect(pausedSubagentStatus('permission')).toBe('waiting_permission')
    expect(pausedSubagentStatus('clarification')).toBe('waiting_question')
  })
  test('没有 SDK RunState 所有权的直接调用不会创建孤儿 checkpoint', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const decision = await service.authorize(
      {
        id: 'direct-tool',
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        name: 'PowerShell',
        input: { command: 'npm publish' },
        permissionConfig: input.permissionConfig,
        model: input.model,
        taskMode: 'chat',
      },
      new AbortController().signal,
    )
    expect(decision.decision).toBe('ask')
    expect(db.sqlite.query('SELECT COUNT(*) AS count FROM approval_requests').get()).toEqual({
      count: 0,
    })
    expect(db.sqlite.query('SELECT COUNT(*) AS count FROM approval_checkpoints').get()).toEqual({
      count: 0,
    })
  })

  test('多路径审批只向 Guardian 和人工请求投影安全范围，checkpoint 保留恢复输入', async () => {
    const path = join(tmpdir(), `pidex-approval-scope-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    let guardianInvocation: ToolInvocation | undefined
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
      async (invocation) => {
        guardianInvocation = invocation
        return { decision: 'ask', risk: 'high', reason: '需要人工确认' }
      },
    )
    const authorizationScope = {
      affectedPaths: [
        { path: 'src/a.ts', operation: 'update' as const },
        { path: 'src/b.ts', operation: 'create' as const },
      ],
      fingerprint: 'a'.repeat(64),
      ruleRequiresApproval: true,
      reviewSummary: {
        fileCount: 2,
        hunkCount: 3,
        additions: 8,
        deletions: 2,
      },
    }
    const invocation: ToolInvocation = {
      id: 'scoped-tool',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'Write',
      input: { patch: 'raw-patch-body', __ruleRequiresApproval: true },
      permissionConfig: { ...input.permissionConfig, approvalsReviewer: 'auto_review' },
      model: input.model,
      taskMode: 'chat',
      authorizationScope,
      durableApproval: true,
    }
    expect(await service.authorize(invocation, new AbortController().signal)).toMatchObject({
      decision: 'ask',
    })
    expect(guardianInvocation?.input).toEqual({
      patchHash: authorizationScope.fingerprint,
      affectedPaths: authorizationScope.affectedPaths,
      summary: authorizationScope.reviewSummary,
    })
    const stored = db.approvalCheckpointForToolCall(invocation.id)
    expect(stored?.payload.invocation.input.patch).toBe('raw-patch-body')
    await service.attachRunState(invocation.id, JSON.stringify({ version: 1 }), {
      name: invocation.name,
      callId: invocation.id,
    })
    const eventRow = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/requested' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    const eventParams = JSON.parse(eventRow.params)
    expect(eventParams).toMatchObject({
      affectedPaths: authorizationScope.affectedPaths,
      reviewSummary: authorizationScope.reviewSummary,
    })
    expect(eventRow.params).not.toContain('raw-patch-body')
    const requestRow = db.sqlite
      .query('SELECT request_payload FROM approval_requests WHERE tool_call_id = ?')
      .get(invocation.id) as { request_payload: string }
    expect(JSON.parse(requestRow.request_payload)).toMatchObject({
      affectedPaths: authorizationScope.affectedPaths,
      reviewSummary: authorizationScope.reviewSummary,
    })
    expect(requestRow.request_payload).not.toContain('raw-patch-body')
  })

  test('审批 durable resolution 后 live publish 失败不回滚响应', async () => {
    const path = join(tmpdir(), `pidex-approval-publish-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = {
      id: 'tool-publish-failure',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm test' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolution = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolution.action !== 'review') throw new Error('测试需要 review 决策')
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolution,
    )
    service.persist(prepared)
    await service.attachRunState(invocation.id, 'run-state', { callId: invocation.id })

    const failingHub = {
      publish: () => Effect.fail(new Error('subscriber unavailable')),
    } as unknown as EventHub
    const responder = new ApprovalService(db, failingHub, tools)
    await expect(responder.respond(prepared.approvalID, 'allow')).resolves.toMatchObject({
      status: 'resolved',
    })
    expect(db.getApprovalCheckpoint(prepared.approvalID)?.status).toBe('resolved')
  })

  test('审批跨重启加载、响应并且只能 claim 一次', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = {
      id: 'tool-1',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'api_key=super-secret; npm test' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    expect(service.load(prepared.approvalID)?.status).toBe('preparing')
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'approval/requested'")
        .get(),
    ).toEqual({ count: 0 })
    await expect(service.respond(prepared.approvalID, 'allow')).rejects.toMatchObject({
      code: 'APPROVAL_NOT_READY',
    })
    await service.attachRunState('tool-1', JSON.stringify({ version: 1, command: 'npm test' }), {
      name: 'PowerShell',
      callId: 'tool-1',
    })
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'approval/requested'")
        .get(),
    ).toEqual({ count: 1 })
    expect(service.load(prepared.approvalID)?.payload.invocation.input.command).toContain(
      '<redacted>',
    )
    expect(service.load(prepared.approvalID)?.payload.runState).not.toContain('super-secret')
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    expect(service.load(prepared.approvalID)?.status).toBe('pending')
    db.sqlite.exec(
      `CREATE TRIGGER fail_resolved_outbox BEFORE INSERT ON events WHEN NEW.method = 'interaction/resolved' BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END`,
    )
    await expect(service.respond(prepared.approvalID, 'allow')).rejects.toThrow(
      'outbox unavailable',
    )
    expect(service.load(prepared.approvalID)?.status).toBe('pending')
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    expect(
      db.sqlite.query('SELECT status FROM agent_executions WHERE id = ?').get(turn.agentID),
    ).toEqual({ status: 'waiting_permission' })
    db.sqlite.exec('DROP TRIGGER fail_resolved_outbox')
    await service.respond(prepared.approvalID, 'allow')
    const resolvedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: prepared.approvalID,
      result: { kind: 'approval', decision: 'allow-once' },
      resolvedAt: expect.any(Number),
    })
    const claimed = service.claimResume(turn.turnID)
    expect(claimed).toMatchObject({ status: 'claimed', decision: 'allow', toolCallID: 'tool-1' })
    expect(service.claimResume(turn.turnID)).toBeNull()
  })

  test('旧 pending 审批没有 checkpoint 时 fail-closed', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn } = setup(db)
    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, created_at) VALUES ('legacy', ?, ?, ?, 'tool-old', 'high', 'legacy', 'pending', '{"version":1}', ?)`,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.updateTurnStatus(turn.turnID, 'waiting_permission')
    db.updateAgentStatus(turn.agentID, 'waiting_permission')
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    db.sqlite.exec(
      `CREATE TRIGGER fail_cancelled_outbox BEFORE INSERT ON events WHEN NEW.method = 'approval/cancelled' BEGIN SELECT RAISE(ABORT, 'cancel outbox unavailable'); END`,
    )
    await expect(service.respond('legacy', 'allow')).rejects.toThrow('cancel outbox unavailable')
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'legacy'").get(),
    ).toEqual({ status: 'pending' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    db.sqlite.exec('DROP TRIGGER fail_cancelled_outbox')
    await expect(service.respond('legacy', 'allow')).rejects.toMatchObject({
      code: 'APPROVAL_CHECKPOINT_MISSING',
    })
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'legacy'").get(),
    ).toEqual({ status: 'cancelled' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
        .get(turn.turnID),
    ).toEqual({ method: 'approval/cancelled' })
    const cancelledEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: 'legacy',
      reason: '审批缺少可恢复 checkpoint',
      cancelledAt: expect.any(Number),
    })
  })

  test('重启扫描会取消不完整审批并写入 durable event', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn } = setup(db)
    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, created_at) VALUES ('restart-legacy', ?, ?, ?, 'tool-old', 'high', 'legacy', 'pending', '{"version":1}', ?)`,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.updateTurnStatus(turn.turnID, 'waiting_permission')
    db.updateAgentStatus(turn.agentID, 'waiting_permission')
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'restart-legacy'").get(),
    ).toEqual({ status: 'cancelled' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
        .get(turn.turnID),
    ).toEqual({ method: 'approval/cancelled' })
    const cancelledEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: 'restart-legacy',
      reason: '审批缺少完整且可恢复的 SDK checkpoint，已安全取消',
      cancelledAt: expect.any(Number),
    })
  })

  test('deny 跨重启恢复且只能 claim 一次', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = {
      id: 'tool-deny',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm publish' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    await service.attachRunState('tool-deny', JSON.stringify({ version: 1 }), {
      name: 'PowerShell',
      callId: 'tool-deny',
    })
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    await service.respond(
      prepared.approvalID,
      'deny',
      '  Authorization: Bearer abc.def.ghi\n请改用只读命令  ',
    )
    expect(service.claimResume(turn.turnID)).toMatchObject({
      status: 'claimed',
      decision: 'deny',
      toolCallID: 'tool-deny',
      payload: {
        resolution: { decision: 'deny', feedback: 'Authorization: <redacted>\n请改用只读命令' },
      },
    })
    expect(service.claimResume(turn.turnID)).toBeNull()
  })

  test('checkpoint 内容被篡改时拒绝响应并中断恢复', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const invocation: ToolInvocation = {
      id: 'tool-tampered',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm test' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    db.sqlite
      .query(
        "UPDATE approval_checkpoints SET payload = json_set(payload, '$.invocation.input.command', 'changed') WHERE approval_id = ?",
      )
      .run(prepared.approvalID)
    await expect(service.respond(prepared.approvalID, 'allow')).rejects.toMatchObject({
      code: 'APPROVAL_CHECKPOINT_INVALID',
    })
    expect(
      db.sqlite.query('SELECT status FROM approval_requests WHERE id = ?').get(prepared.approvalID),
    ).toEqual({ status: 'cancelled' })
  })

  test('动态权限请求携带真实风险，resolved 事件携带原始交互 ID', async () => {
    const path = join(tmpdir(), `pidex-permission-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'permission-call',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'request_permissions',
      input: {
        scope: 'turn',
        readPaths: ['C:\\workspace\\docs'],
        writePaths: ['C:\\workspace\\out'],
        networkDomains: ['api.example.com'],
        justification: '需要读取文档并写入产物',
      },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(
      invocation,
      new ToolRegistry().get('request_permissions'),
    )
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'critical', reason: '需要额外权限' },
      resolved,
    )
    service.persist(prepared)
    await service.attachRunState('permission-call', JSON.stringify({ version: 1 }), {
      name: 'request_permissions',
      callId: 'permission-call',
    })

    const requestedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'permission/requested' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    const requestedParams = JSON.parse(requestedEvent.params)
    expect(requestedParams).toMatchObject({
      interactionId: prepared.approvalID,
      kind: 'permission',
      requestedScope: 'turn',
      allowedScopes: ['tool-call', 'turn'],
      risk: 'critical',
      requestedPermissions: {
        readPaths: ['C:\\workspace\\docs'],
        writePaths: ['C:\\workspace\\out'],
        networkDomains: ['api.example.com'],
      },
    })

    await service.respondPermission(prepared.approvalID, 'allow', {
      scope: 'tool-call',
      grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
    })
    const resolvedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: prepared.approvalID,
      result: {
        kind: 'permission',
        decision: 'grant',
        scope: 'tool-call',
        grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
      },
      resolvedAt: expect.any(Number),
    })
    expect(
      service.permissionGrantResolution(db.getApprovalCheckpoint(prepared.approvalID)!),
    ).toEqual({
      scope: 'tool-call',
      grantedPermissions: { readPaths: ['C:\\workspace\\docs'] },
    })
  })

  test('sandbox escalation token 跨重启保持且只能 claim 一次', async () => {
    const path = join(tmpdir(), `pidex-escalation-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    let service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'shell-failed',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'Write-Output once', cwd: tmpdir() },
      permissionConfig: { ...input.permissionConfig, approvalPolicy: 'on-failure' },
      model: input.model,
      taskMode: 'chat',
    }
    const escalation = service.prepareSandboxEscalation(invocation, 'sandbox denied')
    const permissionInput = {
      scope: 'tool-call',
      escalationToken: escalation.token,
      justification: 'sandbox failed',
    }
    const parsed = new ToolRegistry()
      .get('request_permissions')
      .schema.parse(permissionInput) as typeof permissionInput
    expect(parsed.escalationToken).toBe(escalation.token)
    const permissionInvocation: ToolInvocation = {
      ...invocation,
      id: 'permission-call',
      name: 'request_permissions',
      input: parsed,
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(
      permissionInvocation,
      new ToolRegistry().get('request_permissions'),
    )
    if (resolved.action !== 'review') throw new Error('escalation request 必须进入 SDK approval')
    const prepared = service.prepare(
      permissionInvocation,
      { decision: 'ask', risk: 'high', reason: 'host escalation' },
      resolved,
    )
    expect(prepared.checkpoint.invocation.input.escalationToken).toBe(escalation.token)
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    expect(
      service.claimSandboxEscalation(escalation.token, {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
      })?.invocation.input.command,
    ).toBe('Write-Output once')
    expect(
      service.claimSandboxEscalation(escalation.token, {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
      }),
    ).toBeNull()
    databases.pop()
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(db.getSandboxEscalation(escalation.token)?.status).toBe('cancelled')
  })

  test('sandbox escalation 持久化内容被篡改时 fail closed', async () => {
    const path = join(tmpdir(), `pidex-escalation-tamper-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'shell-tampered',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'Write-Output safe', cwd: tmpdir() },
      permissionConfig: { ...input.permissionConfig, approvalPolicy: 'on-failure' },
      model: input.model,
      taskMode: 'chat',
    }
    const escalation = service.prepareSandboxEscalation(invocation, 'sandbox denied')
    db.sqlite
      .query(
        "UPDATE sandbox_escalations SET invocation = json_set(invocation, '$.input.command', 'Remove-Item dangerous') WHERE token = ?",
      )
      .run(escalation.token)
    expect(
      service.claimSandboxEscalation(escalation.token, {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
      }),
    ).toBeNull()
    expect(db.getSandboxEscalation(escalation.token)?.status).toBe('cancelled')
  })

  test('Hook trust 等待 checkpoint 跨重启保留', async () => {
    const path = join(tmpdir(), `pidex-hook-trust-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn } = setup(db)
    const pending = db.ensureHookTrustRequest({
      threadID: thread.id,
      turnID: turn.turnID,
      workspacePath: 'F:\\repo',
      configPath: 'F:\\repo\\.pidex\\hooks.json',
      configHash: 'hash',
      auditSummary: { hooks: [] },
    })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe('waiting_hook_trust')
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_permission',
    })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe('waiting_hook_trust')
    const resolved = db.resolveHookTrustRequest(pending.request.id, 'block')
    expect(resolved.resumed).toHaveLength(1)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
  })

  test('同一 Hook hash 的并发 turn 复用请求但各收到一次 durable 事件', () => {
    const path = join(tmpdir(), `pidex-hook-trust-waiters-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const first = setup(db)
    const secondThread = db.createThread()
    const second = db.createTurn(secondThread.id, first.input)
    db.claimTurnExecution(second.turnID)
    const trust = {
      workspacePath: 'F:\\repo',
      configPath: 'F:\\repo\\.pidex\\hooks.json',
      configHash: 'same-hash',
      auditSummary: { hooks: [] },
    }
    const initial = db.ensureHookTrustRequest({
      ...trust,
      threadID: first.thread.id,
      turnID: first.turn.turnID,
    })
    const reused = db.ensureHookTrustRequest({
      ...trust,
      threadID: secondThread.id,
      turnID: second.turnID,
    })
    expect(reused.request.id).toBe(initial.request.id)
    const reusedEvent = db.sqlite
      .query("SELECT params FROM events WHERE thread_id = ? AND method = 'hook/trust/requested'")
      .get(secondThread.id) as { params: string }
    const requestedPayload = JSON.parse(reusedEvent.params)
    expect(requestedPayload).toMatchObject({
      interactionId: initial.request.id,
      threadId: secondThread.id,
      turnId: second.turnID,
      agentId: second.agentID,
      kind: 'hookTrust',
      sha256: 'same-hash',
    })
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['hook/trust/requested'].payload)(requestedPayload),
    ).not.toThrow()
    expect(
      db.ensureHookTrustRequest({ ...trust, threadID: secondThread.id, turnID: second.turnID })
        .event,
    ).toBeNull()
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE method = 'hook/trust/requested'")
        .get(),
    ).toEqual({ count: 2 })
    const interactionService = new InteractionService({ db } as never)
    expect(interactionService.listPending({ threadId: secondThread.id }).interactions).toEqual([
      expect.objectContaining({
        interactionId: initial.request.id,
        threadId: secondThread.id,
        turnId: second.turnID,
        agentId: second.agentID,
      }),
    ])
    expect(
      interactionService
        .listPending({})
        .interactions.filter((interaction) => interaction.kind === 'hookTrust'),
    ).toHaveLength(2)
    expect(db.resolveHookTrustRequest(initial.request.id, 'allow').resumed).toHaveLength(2)
    const resolvedEvents = db.sqlite
      .query("SELECT params FROM events WHERE method = 'hook/trust/resolved'")
      .all() as Array<{ params: string }>
    expect(resolvedEvents).toHaveLength(2)
    for (const event of resolvedEvents) {
      expect(() =>
        Schema.decodeUnknownSync(EventManifest['hook/trust/resolved'].payload)(
          JSON.parse(event.params),
        ),
      ).not.toThrow()
    }
  })

  test('Turn 在 preparing 阶段停止会持久取消审批', async () => {
    const path = join(tmpdir(), `pidex-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const invocation: ToolInvocation = {
      id: 'tool-stop',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'PowerShell',
      input: { command: 'npm publish' },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get('PowerShell'))
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要确认' },
      resolved,
    )
    service.persist(prepared)
    service.cancelTurn(turn.turnID)
    expect(
      db.sqlite.query('SELECT status FROM approval_requests WHERE id = ?').get(prepared.approvalID),
    ).toEqual({ status: 'cancelled' })
  })

  test('副作用 prompt recovery 持久中断后可重新排队', async () => {
    const path = join(tmpdir(), `pidex-recovery-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn } = setup(db)
    const persisted = db.interruptForSideEffectRecovery({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      payload: {
        kind: 'side-effect-prompt-recovery',
        attemptOrdinal: 2,
        completed: [{ toolCallID: 'call-1', tool: 'shell', summary: 'done' }],
        error: 'context too long',
      },
    })
    expect(persisted.events.map(({ method }) => method).sort()).toEqual([
      'agent/upserted',
      'context/recoveryRequired',
      'turn/interrupted',
    ])
    expect(
      db.sqlite
        .query(
          "SELECT method FROM events WHERE method = 'context/recoveryRequired' AND turn_id = ?",
        )
        .get(turn.turnID),
    ).toEqual({ method: 'context/recoveryRequired' })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.payload.kind).toBe('side-effect-prompt-recovery')
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'interrupted',
    })
    expect(db.queueSideEffectRecovery(turn.turnID)).toBe(true)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
  })
})
