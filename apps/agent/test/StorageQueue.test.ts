import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { AgentError } from '../src/Domain'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { Model, Provider } from '@pidex/model-schema'
import { EventManifest } from '@pidex/agent-protocol'
import { Schema } from 'effect'

const paths: string[] = []
const modelRef = (providerID: string, id: string) =>
  Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) })
afterEach(async () => removeFixturePaths(paths.splice(0)))

describe('持久化队列', () => {
  test('多 Skill 选择跨编辑、steer 与重启保存，49→50 迁移保留已有输入', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-skill-inputs-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    let db = new AgentDatabase(path)
    const thread = db.createThread()
    const input = {
      content: 'original',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const original = db.createTurn(thread.id, input)
    db.sqlite.exec('ALTER TABLE inputs DROP COLUMN skills; PRAGMA user_version = 49')
    db.close()
    db = new AgentDatabase(path)
    expect(db.getTurnInput(original.turnID)?.content).toBe('original')
    const skills = [
      { name: 'review', path: 'builtin://review/SKILL.md' },
      { name: 'plan', path: 'plugin://tools/skills/plan/SKILL.md' },
    ]
    const turn = db.createTurn(thread.id, { ...input, skills })
    db.updateQueuedInput(
      thread.id,
      turn.inputID,
      'edited',
      { operationID: 'edit-skills' },
      skills.slice(1),
    )
    const guide = db.appendGuide(thread.id, turn.turnID, { ...input, skills, strategy: 'guide' })
    expect(db.guideMailbox(turn.turnID).find((row) => row.id === guide.inputID)?.skills).toEqual(
      skills,
    )
    db.close()
    db = new AgentDatabase(path)
    expect(db.getTurnInput(turn.turnID)).toMatchObject({
      content: 'edited',
      skills: skills.slice(1),
    })
    expect(
      new ThreadProjection(db).snapshot(thread.id)!.inputs.find((row) => row.id === turn.inputID)
        ?.skills,
    ).toEqual(skills.slice(1))
    db.close()
  })
  test('将旧 Turn lifecycle 事件投影为包含完整 turn 和 input 的 canonical payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-turn-events-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const submitted = {
      content: '第二轮',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const turn = db.createTurn(thread.id, submitted, 'queued')
    const projection = new ThreadProjection(db)
    const queued = db.eventsAfter(0, thread.id).find((event) => event.method === 'turn/queued')!
    const queuedPayload = projection.notification(queued).notification.params
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['turn/queued'].payload)(queuedPayload),
    ).not.toThrow()
    expect(queuedPayload).toMatchObject({
      turn: { id: turn.turnID, status: 'queued' },
      input: { id: turn.inputID, content: '第二轮' },
    })

    const startedResult = db.startTurnExecution(turn.turnID, { ...submitted, id: turn.inputID })!
    const started = startedResult.events.find((event) => event.method === 'turn/started')!
    const startedPayload = projection.notification(started).notification.params
    expect(() =>
      Schema.decodeUnknownSync(EventManifest['turn/started'].payload)(startedPayload),
    ).not.toThrow()
    expect(startedPayload).toMatchObject({
      turn: { id: turn.turnID, status: 'running' },
      input: { id: turn.inputID, content: '第二轮' },
    })
    db.close()
  })

  test('保留客户端 inputId 并可恢复既有 turn admission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const input = {
      content: 'client admission',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const created = db.createTurn(thread.id, input, 'queued', { inputID: 'input:client:1' })
    expect(created.inputID).toBe('input:client:1')
    expect(db.inputAdmission('input:client:1')).toMatchObject({
      id: 'input:client:1',
      thread_id: thread.id,
      turn_id: created.turnID,
      content: input.content,
    })
    const guide = db.appendGuide(
      thread.id,
      created.turnID,
      { ...input, strategy: 'guide', content: 'steer' },
      'input:steer:1',
    )
    expect(guide.inputID).toBe('input:steer:1')
    expect(db.inputAdmission('input:steer:1')).toMatchObject({
      turn_id: created.turnID,
      strategy: 'guide',
    })
    db.close()
  })

  test('严格按创建顺序取下一条 Turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const input = {
      content: 'first',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const first = db.createTurn(thread.id, input)
    db.createTurn(thread.id, { ...input, content: 'second' })
    expect(db.nextQueuedTurn(thread.id)?.id).toBe(first.turnID)
    db.close()
  })

  test('FIFO 顺序在重启后保持不变', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const databasePath = join(root, 'agent.sqlite')
    const input = {
      content: 'first',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const db = new AgentDatabase(databasePath)
    const thread = db.createThread()
    const first = db.createTurn(thread.id, input)
    db.createTurn(thread.id, { ...input, content: 'second' })
    db.createTurn(thread.id, { ...input, content: 'third' })
    db.close()

    const reopened = new AgentDatabase(databasePath)
    expect(reopened.nextQueuedTurn(thread.id)?.id).toBe(first.turnID)
    reopened.close()
  })

  test('编辑删除校验版本且相同 operationId 可安全重试', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const input = {
      content: 'queued',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const queued = db.createTurn(thread.id, input)
    db.updateQueuedInput(thread.id, queued.inputID, 'edited', {
      operationID: 'update-1',
      expectedVersion: 1,
    })
    const removed = db.removeQueuedInput(thread.id, queued.inputID, {
      operationID: 'remove-1',
      expectedVersion: 2,
    })
    const duplicate = db.removeQueuedInput(thread.id, queued.inputID, {
      operationID: 'remove-1',
      expectedVersion: 2,
    })
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.event?.id).toBe(removed.event?.id)
    expect(() => db.resumeQueue(thread.id, { operationID: 'stale', expectedVersion: 1 })).toThrow(
      AgentError,
    )
    expect(db.queueStateMeta(thread.id)).toEqual({ version: 3, pauseReason: null })
    db.close()
  })

  test('中断暂停队列并由 resume 恢复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const input = {
      content: 'queued',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const queued = db.createTurn(thread.id, input)
    db.pauseQueue(thread.id, 'interrupted')
    expect(db.nextQueuedTurn(thread.id)).toBeNull()
    db.resumeQueue(thread.id, { operationID: 'resume-1', expectedVersion: 2 })
    expect(db.nextQueuedTurn(thread.id)?.id).toBe(queued.turnID)
    db.close()
  })

  test('中断时未消费的 steer 以原 inputId 转为队首 follow-up', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const input = {
      content: 'active',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'start',
      taskMode: 'chat',
    } as const
    const active = db.createTurn(thread.id, input)
    const agent = db.claimTurnExecution(active.turnID)
    expect(agent).not.toBeNull()
    const firstSteer = db.appendGuide(
      thread.id,
      active.turnID,
      { ...input, content: 'first steer', strategy: 'guide' },
      'input:steer:first',
    )
    const secondSteer = db.appendGuide(
      thread.id,
      active.turnID,
      { ...input, content: 'second steer', strategy: 'guide' },
      'input:steer:second',
    )
    const existing = db.createTurn(thread.id, {
      ...input,
      content: 'existing follow-up',
      strategy: 'queue',
    })

    db.finalizeTurn({
      threadID: thread.id,
      turnID: active.turnID,
      agentID: agent!.id,
      status: 'interrupted',
      pauseReason: 'interrupted',
    })

    const queued = db.sqlite
      .query(
        `
      SELECT i.id
      FROM inputs AS i
      JOIN turns AS t ON t.id = i.turn_id
      WHERE i.thread_id = ? AND i.status = 'queued' AND t.status = 'queued'
      ORDER BY t.queue_position, t.created_at, t.id
    `,
      )
      .all(thread.id) as Array<{ id: string }>
    expect(queued.map(({ id }) => id)).toEqual([
      firstSteer.inputID,
      secondSteer.inputID,
      existing.inputID,
    ])
    expect(db.queueStateMeta(thread.id)?.pauseReason).toBe('interrupted')
    db.close()
  })

  test('删除暂停队列最后一条消息会清除暂停原因', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const thread = db.createThread()
    const input = {
      content: 'queued',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const queued = db.createTurn(thread.id, input)
    db.pauseQueue(thread.id, 'interrupted')
    db.removeQueuedInput(thread.id, queued.inputID, {
      operationID: 'remove-last',
      expectedVersion: 2,
    })
    expect(db.queueStateMeta(thread.id)).toEqual({ version: 3, pauseReason: null })
    db.close()
  })

  test('主 Agent 模型按项目默认和全局默认回退', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const db = new AgentDatabase(join(root, 'agent.sqlite'))
    const project = db.createProject({ rootPath: join(root, 'project'), name: '测试项目' })
    const globalModel = modelRef('openai', 'global')
    const defaultModel = modelRef('openai', 'project')

    db.saveProjectSettings(project.id, { defaultModel })
    expect(db.resolveProjectModel(project.id, globalModel)).toEqual(defaultModel)
    db.saveProjectSettings(project.id, { defaultModel: null })
    expect(db.resolveProjectModel(project.id, globalModel)).toEqual(globalModel)
    db.close()
  })

  test('重启时保留具有 checkpoint 的待回答问题', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-db-'))
    paths.push(root)
    const databasePath = join(root, 'agent.sqlite')
    const db = new AgentDatabase(databasePath)
    const thread = db.createThread()
    const input = {
      content: 'plan',
      model: modelRef('openai', 'gpt'),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
      strategy: 'queue',
      taskMode: 'plan',
    } as const
    const turn = db.createTurn(thread.id, input)
    db.updateTurnStatus(turn.turnID, 'waiting_question')
    db.updateAgentStatus(turn.agentID, 'waiting_question')
    db.saveAgentTurnCheckpoint({
      agentID: turn.agentID,
      turnID: turn.turnID,
      threadID: thread.id,
      state: 'waiting_question',
      payload: { inputID: turn.inputID },
      version: 1,
    })
    db.run(
      "INSERT INTO question_requests (id, thread_id, turn_id, agent_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      'question',
      thread.id,
      turn.turnID,
      turn.agentID,
      JSON.stringify({ question: '确认范围？' }),
      Date.now(),
    )
    db.close()

    const recovered = new AgentDatabase(databasePath)
    expect(recovered.activeTurn(thread.id)).toMatchObject({
      id: turn.turnID,
      status: 'waiting_question',
    })
    expect(
      recovered.sqlite.query("SELECT status FROM question_requests WHERE id = 'question'").get(),
    ).toEqual({ status: 'pending' })
    recovered.close()
  })
})
