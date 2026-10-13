import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { SessionGroupService } from '../src/session-group/SessionGroupService'
import { ThreadReadViewRepository } from '../src/session/ThreadReadViewRepository'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { createThreadReadDefinition } from '../src/tool/ThreadRead/Definition'
import { createWorkgroupReadDefinition } from '../src/tool/WorkgroupRead/Definition'

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.close()
  }
  await removeFixturePaths(paths.splice(0))
}, 30_000)

const submit = (content: string) => ({
  content,
  model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
  strategy: 'queue' as const,
  taskMode: 'chat' as const,
})

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-workgroup-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const service = new SessionGroupService(db, await Effect.runPromise(EventHub.make))
  const workspace = await WorkspaceService.open(root)
  const registry = new ToolRegistry()
  registry.register(createThreadReadDefinition(new ThreadReadViewRepository(db)))
  registry.register(createWorkgroupReadDefinition(service))
  const executor = new ToolExecutor(registry, {
    dataDir: join(root, '.agent-data'),
    userConfigPath: join(root, 'config.json'),
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
  })
  return { root, db, service, workspace, executor, signal: new AbortController().signal }
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>

/** 一轮已完成对话，带用户要求、助手成果与完整计划。 */
const seedTurn = (
  db: AgentDatabase,
  threadID: string,
  label: string,
  createdAt: number,
): { turnID: string } => {
  const created = db.createTurn(threadID, submit(`请处理${label}`), 'completed')
  const item = (id: string, type: 'text' | 'plan', data: Record<string, unknown>) =>
    db.upsertItem(threadID, {
      id,
      turnID: created.turnID,
      agentID: created.agentID,
      type,
      status: 'completed',
      data,
      createdAt,
      updatedAt: createdAt,
    })
  item(`answer-${label}`, 'text', { text: `${label}的最终成果`, placement: 'result' })
  item(`plan-${label}`, 'plan', {
    title: `${label}计划`,
    markdown: `## ${label}完整计划\n- 唯一标记 ${label}`,
  })
  db.sqlite
    .query("UPDATE turns SET status = 'completed', created_at = ?, finished_at = ?, updated_at = ? WHERE id = ?")
    .run(createdAt, createdAt, createdAt, created.turnID)
  return created
}

const contextFor = (fixture: Fixture, threadID: string) => ({
  threadID,
  turnID: 'host-turn',
  taskMode: 'chat' as const,
  signal: fixture.signal,
  workspace: fixture.workspace,
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'auto_review' as const,
  },
})

describe('工作组共享上下文', () => {
  test('首轮即获得所选工作组上下文，包含名称、成员所在项目与共享条目', async () => {
    const fixture = await makeFixture()
    const { db, service } = fixture
    const source = db.createProject({ rootPath: join(fixture.root, 'source'), name: '来源项目' })
    const target = db.createProject({ rootPath: join(fixture.root, 'target'), name: '当前项目' })
    const sourceThread = db.createThread('来源设计会话', source.id)
    const targetThread = db.createThread('实施会话', target.id)
    const group = (
      await service.create({
        name: '登录改造',
        description: '共享登录设计与实施',
        operationId: 'group:create',
      })
    ).group
    await service.setMembership({
      threadId: sourceThread.id,
      groupId: group.id,
      operationId: 'membership:source',
    })
    await service.setMembership({
      threadId: targetThread.id,
      groupId: group.id,
      operationId: 'membership:target',
    })

    const prompt = service.promptForThread(targetThread.id)
    expect(prompt).toBeString()
    expect(prompt).toContain('工作组：登录改造')
    expect(prompt).toContain('说明：共享登录设计与实施')
    expect(prompt).toContain('当前项目：当前项目')
    // 成员索引按项目标注来源，且带会话 ID 供 read_thread 定位。
    expect(prompt).toContain('[来源项目] 来源设计会话')
    expect(prompt).toContain(sourceThread.id)
    expect(prompt).toContain('[当前项目] 实施会话')
    // 引导按需读取完整历史，并声明工作组不扩大权限。
    expect(prompt).toContain('read_thread')
    expect(prompt).toContain('不会扩大当前会话的文件权限')  })

  test('未加入工作组时不注入任何上下文', async () => {
    const fixture = await makeFixture()
    const thread = fixture.db.createThread('独立会话')
    expect(fixture.service.promptForThread(thread.id)).toBeNull()
    expect(fixture.service.readForThread(thread.id)).toBeNull()
  })

  test('超大组仍受 12k 预算约束，成员索引与共享条目优先保留', async () => {
    const fixture = await makeFixture()
    const { db, service } = fixture
    const group = (
      await service.create({
        name: '超大组',
        description: '描'.repeat(3_900),
        operationId: 'group:create',
      })
    ).group
    const threads = Array.from({ length: 40 }, (_, index) =>
      db.createThread(`会话-${index}-${'称'.repeat(80)}`),
    )
    for (const thread of threads)
      await service.setMembership({
        threadId: thread.id,
        groupId: group.id,
        operationId: `membership:${thread.id}`,
      })
    await service.updateContext({
      groupId: group.id,
      digest: '摘'.repeat(5_900),
      entries: Array.from({ length: 10 }, (_, index) => ({
        section: 'finding' as const,
        title: `条${index}`.padEnd(120, '题'),
        content: `内${index}`.padEnd(2_000, '容'),
      })),
    })

    const prompt = service.promptForThread(threads[0]!.id)!
    expect(prompt.length).toBeLessThanOrEqual(12_000)
    expect(prompt).toContain('工作组：超大组')
    // 预算耗尽时先省略摘要，成员索引与共享条目仍然保留。
    expect(prompt).toContain('成员会话：')
    expect(prompt).toContain('有效共享条目：')
    expect(prompt).not.toContain('进展摘要：')
    expect(prompt.endsWith('</session_group_context>')).toBe(true)
  })

  test('加入前的历史与完整计划可用 read_thread 定位读取，成员后续成果同样可读', async () => {
    const fixture = await makeFixture()
    const { db, service } = fixture
    const project = db.createProject({ rootPath: fixture.root, name: '项目' })
    const sourceThread = db.createThread('来源会话', project.id)
    const targetThread = db.createThread('当前会话', project.id)
    // 加入工作组之前就已存在的设计与计划。
    const beforeJoin = Date.now() - 60_000
    seedTurn(db, sourceThread.id, '设计', beforeJoin)
    const group = (await service.create({ name: '共享组', operationId: 'group:create' })).group
    await service.setMembership({
      threadId: sourceThread.id,
      groupId: group.id,
      operationId: 'membership:source',
    })
    await service.setMembership({
      threadId: targetThread.id,
      groupId: group.id,
      operationId: 'membership:target',
    })

    const prompt = service.promptForThread(targetThread.id)!
    expect(prompt).toContain(sourceThread.id)

    // 加入前历史没有被回填成工作组步骤。
    expect(service.listSteps(group.id).steps).toEqual([])

    // 但可以沿成员会话 ID 用 read_thread 翻页读到加入前的用户要求、成果与完整计划。
    const context = contextFor(fixture, targetThread.id)
    const page = await fixture.executor.execute<any>(
      'read_thread',
      { thread_ref: sourceThread.id },
      context,
    )
    const contents = page.entries.map((entry: { content: string }) => entry.content)
    expect(contents).toContain('请处理设计')
    expect(contents).toContain('设计的最终成果')
    expect(contents).toContain('## 设计完整计划\n- 唯一标记 设计')

    // 成员在工作组内产生的后续成果可读。
    seedTurn(db, sourceThread.id, '后续', Date.now())
    const later = await fixture.executor.execute<any>(
      'read_thread',
      { thread_ref: sourceThread.id },
      context,
    )
    expect(later.entries.map((entry: { content: string }) => entry.content)).toContain(
      '后续的最终成果',
    )
  })

  test('删除工作组不删除会话或项目数据', async () => {
    const fixture = await makeFixture()
    const { db, service } = fixture
    const project = db.createProject({ rootPath: fixture.root, name: '保留项目' })
    const thread = db.createThread('保留会话', project.id)
    const turn = db.createTurn(thread.id, submit('保留轮次'))
    // 先让轮次进入历史状态，才能加入工作组。
    db.sqlite
      .query("UPDATE turns SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(Date.now(), Date.now(), turn.turnID)
    const group = (await service.create({ name: '临时组', operationId: 'group:create' })).group
    await service.setMembership({
      threadId: thread.id,
      groupId: group.id,
      operationId: 'membership:join',
    })
    await service.delete({
      groupId: group.id,
      expectedVersion: group.version,
      operationId: 'group:delete',
    })
    expect(db.getThread(thread.id)?.id).toBe(thread.id)
    expect(db.getProject(project.id)?.id).toBe(project.id)
    expect(db.sqlite.query('SELECT id FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      id: turn.turnID,
    })
    expect(service.promptForThread(thread.id)).toBeNull()
  })
})

describe('workgroup_read 工具', () => {
  test('以只读并行元数据注册，进入统一判权并可同时用于 Chat 与 Plan', async () => {
    const fixture = await makeFixture()
    const definition = fixture.executor.definition('workgroup_read')
    expect(definition.sdkName).toBe('workgroup_read')
    expect(definition.approvalStrategy).toBe('never-review')
    expect(definition.executionMode).toBe('parallel')
    expect([...definition.allowedModes].sort()).toEqual(['chat', 'plan'])
    expect(definition.capabilities).toEqual({
      filesystem: 'none',
      network: 'none',
      process: false,
      externalState: false,
      userInteraction: false,
    })
    for (const taskMode of ['chat', 'plan'] as const) {
      const plan = fixture.executor.exposurePlan({
        taskMode,
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        profile: 'main',
      })
      expect(plan.exposed).toContain('workgroup_read')
    }
  })

  test('返回当前会话所属组的成员、共享条目与近期进展，未加入组时拒绝执行', async () => {
    const fixture = await makeFixture()
    const { db, service } = fixture
    const project = db.createProject({ rootPath: fixture.root, name: '项目甲' })
    const sourceThread = db.createThread('来源会话', project.id)
    const targetThread = db.createThread('当前会话', project.id)
    const outsider = db.createThread('组外会话', project.id)
    const group = (
      await service.create({ name: '共享组', description: '共享说明', operationId: 'group:create' })
    ).group
    for (const threadId of [sourceThread.id, targetThread.id])
      await service.setMembership({
        threadId,
        groupId: group.id,
        operationId: `membership:${threadId}`,
      })
    await service.updateContext({
      groupId: group.id,
      entries: [{ section: 'decision', title: '统一错误码', content: '沿用 AUTH_ 前缀' }],
    })
    const turn = seedTurn(db, sourceThread.id, '实施', Date.now())
    await service.captureTurn({
      threadId: sourceThread.id,
      turnId: turn.turnID,
      status: 'completed',
      summary: '按共享条目完成',
    })

    const view = await fixture.executor.execute<any>(
      'workgroup_read',
      {},
      contextFor(fixture, targetThread.id),
    )
    expect(view.group).toMatchObject({ name: '共享组', description: '共享说明' })
    expect(view.currentProject).toBe('项目甲')
    expect(view.members.map((member: { threadId: string }) => member.threadId).sort()).toEqual(
      [sourceThread.id, targetThread.id].sort(),
    )
    expect(
      view.members.find((member: { isCurrent: boolean }) => member.isCurrent)?.threadId,
    ).toBe(targetThread.id)
    expect(view.sharedEntries).toContainEqual(
      expect.objectContaining({ section: 'decision', title: '统一错误码' }),
    )
    expect(view.recentProgress[0]).toMatchObject({
      threadId: sourceThread.id,
      threadTitle: '来源会话',
      status: 'completed',
    })

    await expect(
      fixture.executor.execute('workgroup_read', {}, contextFor(fixture, outsider.id)),
    ).rejects.toMatchObject({ code: 'SESSION_GROUP_NOT_FOUND' })
  })
})
