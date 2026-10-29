import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Effect, Schema } from 'effect'
import { RpcMethods, decodeServerRequestResult } from '@pidex/agent-protocol'
import { ThreadReadViewRepository } from '../src/session/ThreadReadViewRepository'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuestionService, storedQuestions } from '../src/session/QuestionService'
import { createLifecycleTools } from '../src/orchestration/pi/PiToolAdapter'
import { EventHub } from '../src/storage/events/EventHub'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { Model, Provider } from '@pidex/model-schema'
import { interactionQuestions, requestUserInputSchema } from '../src/session/QuestionInput'
import { QuestionAutoResolutionScheduler } from '../src/interaction/QuestionAutoResolutionScheduler'

const databases: AgentDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('问题 checkpoint', () => {
  test('纯文本问题与显式推荐保留结构化 ID；暂停倒计时可持久恢复', async () => {
    const db = new AgentDatabase(join(tmpdir(), `cpx-question-text-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = {
      content: '规划',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'plan',
    } as const
    const turn = db.createTurn(thread.id, input)
    db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
    const questions = [{ id: 'text', header: '需求', question: '补充需求', options: [] }]
    expect(requestUserInputSchema.safeParse({ questions }).success).toBe(true)
    expect(
      interactionQuestions([
        {
          ...questions[0]!,
          options: [
            { label: 'A', description: 'a' },
            { label: 'B', description: 'b', recommended: true },
          ],
        },
      ])[0]?.choices.map((choice) => choice.recommended),
    ).toEqual([false, true])
    // 写入侧契约不变：模型仍只能提交 2 至 3 个选项。
    expect(
      requestUserInputSchema.safeParse({
        questions: [
          {
            id: 'wide',
            header: '方向',
            question: '哪些方向？',
            options: [1, 2, 3, 4].map((index) => ({
              label: `选项 ${index}`,
              description: '说明',
            })),
          },
        ],
      }).success,
    ).toBe(false)
    const service = new QuestionService(db, hub)
    const id = await service.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: 'clarification',
      questions,
      autoResolutionMs: 60_000,
      checkpoint: { state: '{"version":2}', interruption: { name: 'request_user_input' } },
    })
    expect(
      db.repositories.interactions.pendingQuestionPayload(id)?.autoResolutionMs,
    ).toBeUndefined()
    const scheduler = spyOn(QuestionAutoResolutionScheduler.prototype, 'track')
    // Simulate a Plan checkpoint saved by an older build, including an expired deadline.
    db.sqlite
      .query(
        "UPDATE question_requests SET payload = json_set(payload, '$.autoResolutionMs', 60000), created_at = 1 WHERE id = ?",
      )
      .run(id)
    service.restoreAutoResolutions()
    expect(scheduler).not.toHaveBeenCalled()
    scheduler.mockRestore()
    await expect(service.pause(id, 99)).rejects.toThrow('版本')
    await service.pause(id, 2)
    expect(db.repositories.interactions.pendingQuestionPayload(id)).toMatchObject({
      autoResolutionPaused: true,
    })
    service.dispose()
    const restored = new QuestionService(db, hub)
    await expect(
      restored.reply(id, [{ questionId: 'text', choiceIds: [], text: ' ' }]),
    ).rejects.toThrow()
    await restored.reply(
      id,
      [{ questionId: 'text', choiceIds: [], text: '保留自由输入' }],
      false,
      'user',
      false,
    )
    expect(restored.claimResolvedCheckpoint(turn.turnID)?.approval.answer).toContain('保留自由输入')
    await expect(restored.pause(id, 2)).rejects.toThrow('失效')
    restored.dispose()
  })
  test.each([false, true])(
    '逐题跳过经过校验、持久化、严格历史及恢复保留（全部跳过：%s）',
    async (skipAll) => {
      const path = join(tmpdir(), `pidex-question-skip-${crypto.randomUUID()}.sqlite`)
      const db = new AgentDatabase(path)
      databases.push(db)
      const hub = await Effect.runPromise(EventHub.make)
      const thread = db.createThread()
      const input = {
        content: '规划',
        model: Model.Ref.make({
          providerID: Provider.ID.make('openai'),
          id: Model.ID.make('test'),
        }),
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        strategy: 'queue',
        taskMode: 'plan',
      } as const
      const turn = db.createTurn(thread.id, input)
      db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
      const service = new QuestionService(db, hub)
      const id = await service.checkpoint(thread.id, turn.turnID, turn.agentID, {
        kind: 'clarification',
        questions: ['scope', 'format', 'selection'].map((id) => ({
          id,
          header: id,
          question: `Choose ${id}`,
          options: [
            { label: 'A', description: '第一项说明' },
            { label: 'B', description: '第二项说明' },
          ],
        })),
        checkpoint: { state: '{"version":2}', interruption: { name: 'request_user_input' } },
      })
      const answers = ['scope', 'format', 'selection'].map((questionId, index) =>
        skipAll || index === 0
          ? { questionId, choiceIds: [], skipped: true as const }
          : { questionId, choiceIds: [`${questionId}:1`] },
      )
      for (const invalid of [
        answers.slice(1),
        [{ questionId: 'scope', choiceIds: [] }, ...answers.slice(1)],
        [{ ...answers[0], choiceIds: ['scope:0'] }, ...answers.slice(1)],
        [{ ...answers[0], text: '' }, ...answers.slice(1)],
        [...answers, answers[0]],
      ])
        await expect(service.reply(id, invalid)).rejects.toThrow()
      await expect(service.reply(id, answers, false, 'auto')).rejects.toThrow()
      expect(db.repositories.interactions.isQuestionPending(id)).toBe(true)
      await service.reply(id, answers, false, 'user', false)
      const event = db.sqlite
        .query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?")
        .get(turn.turnID) as { params: string }
      expect(
        decodeServerRequestResult('question/request', JSON.parse(event.params).result),
      ).toMatchObject({ status: 'answered', answers })
      service.dispose()
      databases.splice(databases.indexOf(db), 1)
      db.close()
      const reopened = new AgentDatabase(path)
      databases.push(reopened)
      // Restart recovery queues the interrupted turn; resume it before reading its history page.
      reopened.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
      const definition = RpcMethods['thread/history/read']
      const history = new ThreadReadViewRepository(reopened).history(thread.id, { limit: 10 })
      const encoded = Schema.encodeSync(definition.result, { onExcessProperty: 'error' })(history)
      const question = encoded.turns
        .flatMap((turn) => turn.items)
        .find((item) => item.type === 'question')
      expect(question).toMatchObject({
        id,
        status: 'answered',
        answers,
        questions: [
          {
            id: 'scope',
            minAnswers: 1,
            maxAnswers: 1,
            choices: [{ description: '第一项说明' }, { description: '第二项说明' }],
          },
          { id: 'format' },
          { id: 'selection' },
        ],
      })
      const restored = new QuestionService(reopened, hub)
      expect(JSON.parse(restored.claimResolvedCheckpoint(turn.turnID)!.approval.answer!)).toEqual({
        resolution: 'user',
        answers,
      })
      restored.dispose()
    },
  )

  test('request_user_input 接受 rich questions 并拒绝越界超时', async () => {
    const received: unknown[] = []
    const [tool] = createLifecycleTools(
      {
        requestUserInput: async (input) => {
          received.push(input)
          return { paused: true }
        },
      },
      { exposedTools: ['request_user_input'] } as never,
    )
    const input = {
      questions: [
        {
          id: 'delivery',
          header: '发送方式',
          question: '下一条消息如何处理？',
          options: [
            { label: 'Steer', description: '进入当前 Turn' },
            { label: '排队', description: '等待下一 Turn' },
          ],
        },
      ],
      autoResolutionMs: 60_000,
    }
    await tool!.execute('question-call', input as never, new AbortController().signal)
    expect(received).toEqual([input])
    await expect(
      tool!.execute(
        'question-call-2',
        { ...input, autoResolutionMs: 59_999 } as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })

  test('rich questions 按结构化 answers 恢复，不压平多题答案', async () => {
    const db = new AgentDatabase(
      join(tmpdir(), `pidex-question-rich-${crypto.randomUUID()}.sqlite`),
    )
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = {
      content: '规划一个改动',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'plan',
    } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const questions = new QuestionService(db, hub)
    const id = await questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: 'clarification',
      questions: [
        {
          id: 'delivery',
          header: '发送方式',
          question: '下一条消息如何处理？',
          options: [
            { label: 'Steer', description: '进入当前 Turn' },
            { label: '排队', description: '等待下一 Turn' },
          ],
        },
        {
          id: 'persist',
          header: '持久化',
          question: '是否持久化？',
          options: [
            { label: '是', description: '写入 SQLite' },
            { label: '否', description: '仅保存在内存' },
          ],
        },
      ],
      checkpoint: {
        state: '{"version":2}',
        interruption: {
          name: 'request_user_input',
          toolCallID: 'question-call',
        },
      },
    })
    const row = db.sqlite
      .query('SELECT payload, payload_version, tool_call_id FROM question_requests WHERE id = ?')
      .get(id) as { payload: string; payload_version: number; tool_call_id: string }
    expect(row.payload_version).toBe(2)
    expect(row.tool_call_id).toBe('question-call')
    expect(JSON.parse(row.payload).questions).toHaveLength(2)

    await questions.reply(id, [
      { questionId: 'delivery', choiceIds: ['delivery:0'] },
      { questionId: 'persist', choiceIds: [], text: '需要持久化' },
    ])
    const checkpoint = questions.claimResolvedCheckpoint(turn.turnID)
    expect(JSON.parse(checkpoint!.approval.answer!)).toEqual({
      resolution: 'user',
      answers: [
        { questionId: 'delivery', choiceIds: ['delivery:0'] },
        { questionId: 'persist', choiceIds: [], text: '需要持久化' },
      ],
    })
  })

  test('回复持久化 RunState 并触发恢复回调，不依赖内存 Promise', async () => {
    const db = new AgentDatabase(join(tmpdir(), `pidex-question-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = {
      content: '规划一个改动',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'plan',
    } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const questions = new QuestionService(db, hub)
    const resumed: string[] = []
    questions.setResumeHandler((_threadID, turnID) => resumed.push(turnID))
    const id = await questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: 'clarification',
      question: '选择实现方式',
      options: ['A', 'B'],
      checkpoint: { state: '{"version":1}', interruption: { name: 'request_user_input' } },
    })

    await questions.reply(id, 'A')
    const checkpoint = questions.claimResolvedCheckpoint(turn.turnID)

    expect(resumed).toEqual([turn.turnID])
    expect(checkpoint?.approval).toEqual({
      state: '{"version":1}',
      interruption: { name: 'request_user_input' },
      answer: 'A',
      checkpointID: id,
    })
  })

  test('问题创建和回复在 outbox 失败时整体回滚', async () => {
    const db = new AgentDatabase(
      join(tmpdir(), `pidex-question-atomic-${crypto.randomUUID()}.sqlite`),
    )
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = {
      content: '规划一个改动',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'plan',
    } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const questions = new QuestionService(db, hub)
    db.sqlite.exec(
      `CREATE TRIGGER fail_question_requested BEFORE INSERT ON events WHEN NEW.method = 'question/requested' BEGIN SELECT RAISE(ABORT, 'question outbox unavailable'); END`,
    )
    await expect(
      questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
        kind: 'clarification',
        question: '选择实现方式',
        options: ['A', 'B'],
        checkpoint: { state: '{"version":1}', interruption: { name: 'request_user_input' } },
      }),
    ).rejects.toThrow('question outbox unavailable')
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM question_requests WHERE turn_id = ?')
        .get(turn.turnID),
    ).toEqual({ count: 0 })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'running',
    })
    db.sqlite.exec('DROP TRIGGER fail_question_requested')

    const id = await questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: 'clarification',
      question: '选择实现方式',
      options: ['A', 'B'],
      checkpoint: { state: '{"version":1}', interruption: { name: 'request_user_input' } },
    })
    db.sqlite.exec(
      `CREATE TRIGGER fail_question_resolved BEFORE INSERT ON events WHEN NEW.method = 'interaction/resolved' BEGIN SELECT RAISE(ABORT, 'resolve outbox unavailable'); END`,
    )
    await expect(questions.reply(id, 'A')).rejects.toThrow('resolve outbox unavailable')
    expect(db.sqlite.query('SELECT status FROM question_requests WHERE id = ?').get(id)).toEqual({
      status: 'pending',
    })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'waiting_question',
    })
    db.sqlite.exec('DROP TRIGGER fail_question_resolved')

    const operation = {
      operationID: 'question:resolve:atomic',
      interactionID: id,
      response: {
        kind: 'question',
        status: 'answered',
        answers: [{ questionId: 'question-tool', choiceIds: ['question-tool:0'] }],
        resolution: 'user',
      },
      result: { interactionId: id, state: 'resolved' },
    }
    db.sqlite.exec(
      `CREATE TRIGGER fail_interaction_operation BEFORE INSERT ON interaction_operations BEGIN SELECT RAISE(ABORT, 'operation unavailable'); END`,
    )
    await expect(questions.reply(id, 'A', false, 'user', false, operation)).rejects.toThrow(
      'operation unavailable',
    )
    expect(db.sqlite.query('SELECT status FROM question_requests WHERE id = ?').get(id)).toEqual({
      status: 'pending',
    })
    expect(db.interactionOperation(operation.operationID)).toBeNull()
    db.sqlite.exec('DROP TRIGGER fail_interaction_operation')

    await questions.reply(id, 'A', false, 'user', false, operation)
    expect(db.interactionOperation(operation.operationID)?.result).toEqual(operation.result)
    const resolvedEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?")
      .get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: id,
      result: operation.response,
      resolvedAt: expect.any(Number),
    })
  })

  test('Plan 轮次不产生倒计时也不参与自动作答，空答案不会被当成用户决定', async () => {
    const db = new AgentDatabase(
      join(tmpdir(), `pidex-question-plan-auto-${crypto.randomUUID()}.sqlite`),
    )
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const model = Model.Ref.make({
      providerID: Provider.ID.make('openai'),
      id: Model.ID.make('test'),
    })
    const permissionConfig = {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    } as const
    const askQuestions = [
      {
        id: 'scope',
        header: '范围',
        question: '覆盖哪些客户端？',
        options: [
          { label: '仅桌面端', description: '集中完成桌面交互' },
          { label: '桌面端与 CLI', description: '同时设计共享能力' },
        ],
      },
    ]
    const admission = (taskMode: 'plan' | 'chat') => {
      const thread = db.createThread()
      const input = {
        content: '规划',
        model,
        permissionConfig,
        strategy: 'queue',
        taskMode,
      } as const
      const turn = db.createTurn(thread.id, input)
      db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
      return { thread, turn }
    }
    const service = new QuestionService(db, hub)
    const track = spyOn(QuestionAutoResolutionScheduler.prototype, 'track')
    const reply = spyOn(QuestionService.prototype, 'reply')

    // Plan 轮次：即使模型请求了 autoResolutionMs，也不暴露倒计时、不登记定时器。
    const plan = admission('plan')
    const planId = await service.checkpoint(plan.thread.id, plan.turn.turnID, plan.turn.agentID, {
      kind: 'clarification',
      questions: askQuestions,
      autoResolutionMs: 60_000,
      checkpoint: { state: '{"version":2}', interruption: { name: 'request_user_input' } },
    })
    expect(
      db.repositories.interactions.pendingQuestionPayload(planId)?.autoResolutionMs,
    ).toBeUndefined()
    expect(track).not.toHaveBeenCalled()
    const restoreCandidates = db.repositories.interactions.pendingAutoResolutionQuestions()
    expect(restoreCandidates.map((row) => row.id)).toContain(planId)
    expect(
      restoreCandidates.find((row) => row.id === planId)?.payload.autoResolutionMs,
    ).toBeUndefined()

    // 旧版本写入的 Plan 倒计时即使已经过期，恢复时也不能自动作答。
    db.sqlite
      .query(
        "UPDATE question_requests SET payload = json_set(payload, '$.autoResolutionMs', 60000), created_at = 1 WHERE id = ?",
      )
      .run(planId)
    expect(
      db.repositories.interactions.pendingAutoResolutionQuestions().map((row) => row.id),
    ).toContain(planId)
    service.restoreAutoResolutions()
    expect(track).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()

    // 空答案没有变成用户决定：问题仍然待答，也没有写入任何 resolution 事件。
    expect(db.repositories.interactions.isQuestionPending(planId)).toBe(true)
    expect(
      db.sqlite
        .query(
          "SELECT COUNT(*) AS count FROM events WHERE method = 'interaction/resolved' AND turn_id = ?",
        )
        .get(plan.turn.turnID),
    ).toEqual({ count: 0 })

    // 对照：Chat 轮次保留倒计时并登记定时器，说明豁免只针对 Plan。
    const chat = admission('chat')
    const chatId = await service.checkpoint(chat.thread.id, chat.turn.turnID, chat.turn.agentID, {
      kind: 'clarification',
      questions: askQuestions,
      autoResolutionMs: 60_000,
      checkpoint: { state: '{"version":2}', interruption: { name: 'request_user_input' } },
    })
    expect(db.repositories.interactions.pendingQuestionPayload(chatId)?.autoResolutionMs).toBe(
      60_000,
    )
    expect(track).toHaveBeenCalledTimes(1)

    reply.mockRestore()
    track.mockRestore()
    service.dispose()
  })

  /**
   * 共享 ~/.pidex 时，其它构建可能写入超过本构建写入上限的选项。读取侧必须
   * 接受并允许作答，否则会出现“卡片可见但永久无法回答”。
   */
  test('读取侧接受超出写入上限的选项并允许作答', async () => {
    const db = new AgentDatabase(join(tmpdir(), `cpx-question-wide-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = {
      content: '澄清',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'user' as const,
      },
      strategy: 'queue' as const,
      taskMode: 'chat' as const,
    }
    const turn = db.createTurn(thread.id, input)
    db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
    const choices = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id,
      label: `选项 ${id}`,
      description: id,
      recommended: false,
    }))
    const questions = [
      {
        id: 'optimization_axis',
        header: '方向',
        prompt: '主要指哪个方向？',
        choices,
        allowFreeform: true,
        required: true,
        minAnswers: 1,
        maxAnswers: 1,
      },
    ]
    // 直接落库，模拟其它构建写入的 payload。
    const { question } = db.createResumableQuestion({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: 'call-wide',
      payload: { questions, question: questions[0]!.prompt, options: choices.map((c) => c.label) },
      payloadVersion: 2,
      checkpoint: { payload: { state: '', interruption: null }, version: 1 },
    })
    expect(storedQuestions({ questions })[0]?.choices).toHaveLength(5)

    const service = new QuestionService(db, hub)
    await service.reply(
      question.id,
      { answers: [{ questionId: 'optimization_axis', choiceIds: ['e'] }] },
      false,
      'user',
      false,
    )
    expect(db.repositories.interactions.isQuestionPending(question.id)).toBe(false)
    service.dispose()
  })
})
