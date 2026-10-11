import { afterEach, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { SubagentService } from '../src/subagent/SubagentService'
import { SubagentRepository } from '../src/subagent/SubagentRepository'
import { SubagentCollaborationRepository } from '../src/subagent/SubagentCollaborationRepository'
import type {
  AgentRuntimeRequest,
  AgentRuntimeResult,
} from '../src/orchestration/AgentRuntimeTypes'
import { removeFixturePaths } from './FixtureCleanup'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { SCHEMA_VERSION } from '../src/storage/database/Schema'

const paths: string[] = []
const databases: AgentDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(paths.splice(0))
})
const model = Model.Ref.make({
  providerID: Provider.ID.make('openai'),
  id: Model.ID.make('fixture'),
})
const permission = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const
const completed: AgentRuntimeResult = {
  status: 'completed',
  output: '完成',
  result: {
    outcome: 'succeeded',
    summary: '完成',
    findings: [],
    changedFiles: [],
    validation: [],
    risks: [],
    references: [],
  },
}

function fixture(
  run: (request: AgentRuntimeRequest) => Promise<AgentRuntimeResult> = async () => completed,
) {
  const path = join(tmpdir(), `cpx-recursive-${crypto.randomUUID()}.sqlite`)
  paths.push(path)
  const db = new AgentDatabase(path)
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: 'root',
    model,
    permissionConfig: permission,
    strategy: 'queue',
    taskMode: 'chat',
  })
  const service = new SubagentService(
    db,
    { publish: () => Effect.void } as never,
    { resolve: async () => model, getModel: async () => ({ contextWindow: 8000 }) } as never,
    { setAgentStatusHandler: () => {}, cancelTurn: () => {} } as never,
    { cancelTurn: () => {} } as never,
    { run } as never,
    { listByBinding: async () => [] } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  )
  const root: Parameters<SubagentService['delegationFor']>[0] = {
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    taskMode: 'chat' as const,
    model,
    permissionConfig: permission,
    workspaceRoot: process.cwd(),
  }
  return { db, service, root, repo: service.repository }
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('协作状态未按期收敛')
}

test('递归三层、直接父子归属、跨轮身份与只读权限继承', async () => {
  const { db, service, root, repo } = fixture()
  let parent = root
  for (let depth = 1; depth <= 3; depth++) {
    const created = repo.create({
      parentThreadID: parent.threadID,
      parentTurnID: parent.turnID,
      parentAgentID: parent.agentID,
      displayName: `层 ${depth}`,
      profile: 'explorer',
      task: '探索',
      model,
      permissionCeiling: parent.permissionConfig,
      workspaceMode: 'shared',
      workspaceRoot: process.cwd(),
    })
    expect(created.agent.depth).toBe(depth)
    expect(created.run.permissionConfig.sandboxMode).toBe('read-only')
    parent = {
      ...root,
      threadID: created.task.childThreadId,
      turnID: created.agent.turnID,
      agentID: created.agent.id,
      permissionConfig: created.run.permissionConfig,
    }
  }
  await expect(service.spawn(parent, [{ profile: 'explorer', task: '第四层' }])).rejects.toThrow(
    '最大深度',
  )
  const child = service.list(root.threadID)[0]!
  const controller = service.delegationFor(parent)
  await expect(controller.send({ taskID: child.task.id, message: '越权' })).rejects.toThrow(
    '直接子',
  )
  expect(() => service.collaboration.assertRuns(parent.threadID, [child.currentRun!.id])).toThrow(
    '直接子',
  )
  const next = db.createTurn(root.threadID, {
    content: '下一轮',
    model,
    permissionConfig: permission,
    strategy: 'queue',
    taskMode: 'chat',
  })
  service.collaboration.assertChild(root.threadID, child.task.id)
  expect(next.agentID).not.toBe(root.agentID)
})

test('后续消息 FIFO、幂等及整树停止等待实际退出', async () => {
  const started: string[] = []
  const release = new Map<string, () => void>()
  const { service, root, repo } = fixture(async (request) => {
    const label = request.content.startsWith('子 Agent 任务：') ? '初始' : request.content
    started.push(label)
    await new Promise<void>((resolve) => {
      release.set(label, resolve)
      request.signal.addEventListener('abort', () => resolve(), { once: true })
    })
    return completed
  })
  const spawned = await service.spawn(root, [{ profile: 'worker', task: '初始' }])
  const taskID = spawned.agents[0]!.taskId
  await until(() => started.length === 1)
  const first = await service.followup(taskID, '第二轮', 'message:1')
  expect(await service.followup(taskID, '第二轮', 'message:1')).toEqual(first)
  await expect(service.followup(taskID, '不同消息', 'message:1')).rejects.toThrow('operationId')
  await service.followup(taskID, '第三轮', 'message:2')
  expect(started).toEqual(['初始'])
  expect(repo.task(taskID)!.queuedFollowups).toBe(2)
  release.get('初始')!()
  await until(() => started.length === 2)
  expect(started[1]).toBe('第二轮')
  release.get('第二轮')!()
  await until(() => started.length === 3)
  await service.stop(taskID, 'stop:1')
  expect(repo.task(taskID)!.currentRun!.status).toBe('stopped')
  expect(
    service.collaboration.notices(root.threadID).filter((n) => n.kind === 'settled'),
  ).toHaveLength(3)
})

test('递归 wait 释放并发、完成门禁等待后代并复用已计算结果', async () => {
  let releaseLeaf: (() => void) | undefined
  let parentSamples = 0
  const { service, root, repo } = fixture(async (request) => {
    if (request.depth === 1) {
      parentSamples++
      await request.delegation!.spawn({ agents: [{ profile: 'worker', task: '后代' }] })
    } else
      await new Promise<void>((resolve) => {
        releaseLeaf = resolve
      })
    return completed
  })
  const spawned = await service.spawn(root, [{ profile: 'worker', task: '父任务' }])
  const taskID = spawned.agents[0]!.taskId
  await until(() => Boolean(releaseLeaf) && repo.task(taskID)!.waitingForDescendants === true)
  expect(repo.task(taskID)!.currentRun!.status).not.toBe('completed')
  releaseLeaf!()
  await until(() => repo.task(taskID)!.currentRun!.status === 'completed')
  expect(parentSamples).toBe(1)
  expect(service.collaboration.completions()).toHaveLength(0)
})

test('等待中的父任务不占并发；持久化队列和结果重启后保留', () => {
  const { db, root, repo } = fixture()
  const child = () =>
    repo.create({
      parentThreadID: root.threadID,
      parentTurnID: root.turnID,
      parentAgentID: root.agentID,
      displayName: 'child',
      profile: 'worker',
      task: 'task',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: process.cwd(),
    })
  const parents = Array.from({ length: 4 }, child)
  for (const parent of parents) {
    expect(repo.claim(parent.run.id)).not.toHaveProperty('queued')
    db.updateAgentStatus(parent.agent.id, 'waiting_subagents')
  }
  expect(repo.claim(child().run.id)).not.toHaveProperty('queued')
  const collaboration = new SubagentCollaborationRepository(db)
  collaboration.save(parents[0]!.task.childThreadId, parents[0]!.agent.turnID, completed)
  const queued = repo.continueTask({
    taskID: parents[0]!.task.id,
    message: '后续',
    sameRun: false,
    enqueue: true,
  })
  db.repositories.subagents.recoverInterruptedSubagents(Date.now())
  expect(collaboration.saved(parents[0]!.agent.turnID)).toEqual(completed)
  expect(repo.run(queued.run.id)!.status).toBe('queued')
  expect(repo.run(parents[0]!.run.id)!.status).toBe('running')
})

test('四个父任务等待后代时不死锁，checkpoint 恢复原有父轮次', async () => {
  const release: Array<() => void> = []
  let resumed = 0
  const { service, root, repo } = fixture(async (request) => {
    if (request.depth === 1) {
      if (request.resume) {
        resumed++
        return completed
      }
      const value = (await request.delegation!.spawn({
        agents: [{ profile: 'worker', task: 'leaf' }],
      })) as { agents: Array<{ runId: string }> }
      const runIDs = value.agents.map((agent) => agent.runId)
      expect(await request.delegation!.isWaitSatisfied({ runIDs, mode: 'all' })).toBe(false)
      await request.pause({
        kind: 'subagents',
        runIDs,
        waitMode: 'all',
        toolCallID: `wait:${request.agentID}`,
        checkpoint: {
          state: JSON.stringify({ engine: 'pi', sessionID: request.sessionID }),
          interruption: { toolCallID: `wait:${request.agentID}` },
        },
      })
      return { status: 'paused', output: '' }
    }
    await new Promise<void>((resolve) => release.push(resolve))
    return completed
  })
  const created = await service.spawn(
    root,
    Array.from({ length: 4 }, () => ({ profile: 'worker' as const, task: 'parent' })),
  )
  await until(() => release.length === 4)
  for (const finish of release) finish()
  await until(() => created.agents.every((agent) => repo.run(agent.runId)!.status === 'completed'))
  expect(resumed).toBe(4)
})

test('父代理停止递归树，后续消息与新派发在停止期间被拒绝', async () => {
  let leafRequest: AgentRuntimeRequest | undefined
  let leafExited = false
  const { service, root, repo } = fixture(async (request) => {
    if (request.depth === 1) {
      await request.delegation!.spawn({ agents: [{ profile: 'worker', task: 'leaf' }] })
      return completed
    }
    leafRequest = request
    await new Promise<void>((resolve) =>
      request.signal.addEventListener(
        'abort',
        () => {
          setTimeout(() => {
            leafExited = true
            resolve()
          }, 20)
        },
        { once: true },
      ),
    )
    return completed
  })
  const created = await service.spawn(root, [{ profile: 'worker', task: 'parent' }])
  await until(() => Boolean(leafRequest))
  const parentID = created.agents[0]!.taskId
  const leaf = service.list(leafRequest!.threadID)
  expect(leaf).toHaveLength(0)
  const stopping = service.stop(parentID, 'stop:tree')
  await expect(service.followup(parentID, 'late', 'message:late')).rejects.toThrow('停止')
  await stopping
  expect(leafExited).toBe(true)
  expect(repo.task(parentID)!.currentRun!.status).toBe('stopped')
  expect(service.collaboration.pending(repo.task(parentID)!.childThreadId)).toHaveLength(0)
})

test('schema57 升级保存未知对象，重开保留已接纳消息与最终结果', () => {
  const { db, root, repo } = fixture()
  const child = repo.create({
    parentThreadID: root.threadID,
    parentTurnID: root.turnID,
    parentAgentID: root.agentID,
    displayName: 'child',
    profile: 'worker',
    task: 'task',
    model,
    permissionCeiling: permission,
    workspaceMode: 'shared',
    workspaceRoot: process.cwd(),
  })
  const path = paths.at(-1)!
  const collaboration = new SubagentCollaborationRepository(db)
  collaboration.save(child.task.childThreadId, child.agent.turnID, completed)
  collaboration.record('message:durable', child.task.id, 'followup', 'next', { accepted: true })
  db.sqlite.exec(
    "CREATE TABLE future_records (value TEXT); INSERT INTO future_records VALUES ('preserved'); PRAGMA user_version=57",
  )
  db.close()
  databases.splice(databases.indexOf(db), 1)
  const reopened = new AgentDatabase(path)
  databases.push(reopened)
  const restored = new SubagentCollaborationRepository(reopened)
  expect(restored.saved(child.agent.turnID)).toEqual(completed)
  expect(restored.replay('message:durable', child.task.id, 'followup', 'next')).toEqual({
    accepted: true,
  })
  expect(reopened.sqlite.query('SELECT value FROM future_records').get()).toEqual({
    value: 'preserved',
  })
})

test('缺少协作表的更高 schema 保留数据，降级新能力且既有快照可读', () => {
  const { db, root, repo } = fixture()
  repo.create({
    parentThreadID: root.threadID,
    parentTurnID: root.turnID,
    parentAgentID: root.agentID,
    displayName: 'child',
    profile: 'worker',
    task: 'task',
    model,
    permissionCeiling: permission,
    workspaceMode: 'shared',
    workspaceRoot: process.cwd(),
  })
  const path = paths.at(-1)!
  db.sqlite.exec(
    `DROP TABLE subagent_messages; DROP TABLE subagent_completions; PRAGMA user_version=${SCHEMA_VERSION + 1}`,
  )
  db.close()
  databases.splice(databases.indexOf(db), 1)
  const reopened = new AgentDatabase(path)
  databases.push(reopened)
  expect(filterAdvertisedCapabilities(reopened)).not.toContain('subagents.recursive.v1')
  expect(filterAdvertisedCapabilities(reopened)).not.toContain('subagents.followup.v1')
  expect(new ThreadProjection(reopened).snapshot(root.threadID)!.subagents).toHaveLength(1)
  expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
    user_version: SCHEMA_VERSION + 1,
  })
  expect(
    reopened.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'subagent_messages'").get(),
  ).toBeNull()
})

test('协作工具经过统一执行校验，不能绕过 profile、Skill allowlist 或取消', async () => {
  const executor = new ToolExecutor(new ToolRegistry())
  let calls = 0
  const context = {
    threadID: 'thread',
    turnID: 'turn',
    taskMode: 'chat' as const,
    profile: 'worker' as const,
    signal: new AbortController().signal,
    workspace: await WorkspaceService.open(process.cwd()),
    permissionConfig: permission,
    subagentLifecycle: async () => {
      calls++
      return { accepted: true }
    },
  }
  await expect(
    executor.execute(
      'followup_agent',
      { taskID: 'child', message: 'task', __ruleRequiresApproval: false },
      context,
    ),
  ).rejects.toThrow()
  await expect(
    executor.execute('report_agent', { message: 'progress' }, { ...context, profile: 'main' }),
  ).rejects.toThrow()
  await expect(
    executor.execute(
      'followup_agent',
      { taskID: 'child', message: 'task' },
      { ...context, allowedTools: ['Read'] },
    ),
  ).rejects.toThrow()
  expect(calls).toBe(0)
  await executor.execute('followup_agent', { taskID: 'child', message: 'task' }, context)
  expect(calls).toBe(1)
  await expect(
    executor.execute(
      'followup_agent',
      { taskID: 'child', message: 'task' },
      { ...context, signal: AbortSignal.abort() },
    ),
  ).rejects.toThrow()
  expect(calls).toBe(1)
})

test('父代理显式工具白名单持久化并限制后代，不能在递归时扩大', async () => {
  const scopes: Array<readonly string[] | undefined> = []
  const { service, root, repo } = fixture(async (request) => {
    scopes.push(request.allowedTools)
    if (request.depth === 1)
      await request.delegation!.spawn(
        { agents: [{ profile: 'worker', task: 'child' }] },
        { permissionConfig: permission, allowedTools: ['Read', 'Write', 'spawn_agents'] },
      )
    return completed
  })
  const created = (await service
    .delegationFor(root)
    .spawn(
      { agents: [{ profile: 'worker', task: 'parent' }] },
      { permissionConfig: permission, allowedTools: ['Read', 'spawn_agents'] },
    )) as { agents: Array<{ taskId: string }> }
  await until(() => repo.task(created.agents[0]!.taskId)!.currentRun!.status === 'completed')
  expect(scopes).toEqual([
    ['Read', 'spawn_agents'],
    ['Read', 'spawn_agents'],
  ])
  expect(service.collaboration.allowedTools(created.agents[0]!.taskId)).toEqual([
    'Read',
    'spawn_agents',
  ])
})
