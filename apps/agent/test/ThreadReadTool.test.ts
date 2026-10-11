import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentError, type Item } from '../src/Domain'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { ThreadHistoryService } from '../src/session/ThreadHistoryService'
import { ThreadReadViewRepository } from '../src/session/ThreadReadViewRepository'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { ToolExecutor } from '../src/tool/ToolExecutor'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import { createThreadReadDefinition } from '../src/tool/ThreadRead/Definition'
import { Model, Provider } from '@pidex/model-schema'
import { buildThreadDeepLink, resolveThreadReference } from '@pidex/shared/thread-reference'

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.close()
  }
  await removeFixturePaths(paths.splice(0))
})

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-thread-read-tool-'))
  paths.push(root)
  const databasePath = join(root, 'agent.sqlite')
  const db = new AgentDatabase(databasePath)
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  const history = new ThreadHistoryService(db, hub)
  const workspace = await WorkspaceService.open(root)
  const registry = new ToolRegistry()
  const readThreadDefinition = createThreadReadDefinition(new ThreadReadViewRepository(db))
  registry.register(readThreadDefinition)
  const executor = new ToolExecutor(registry, {
    dataDir: join(root, '.agent-data'),
    userConfigPath: join(root, 'config.json'),
    authorizeShell: async () => ({ decision: 'allow', risk: 'low', reason: 'test' }),
  })
  return {
    root,
    databasePath,
    db,
    history,
    workspace,
    executor,
    readThreadDefinition,
    signal: new AbortController().signal,
  }
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>

const contextFor = (fixture: Fixture) => ({
  threadID: 'host-thread',
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

const submitInput = (content: string) => ({
  content,
  model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt') }),
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'auto_review' as const,
  },
  strategy: 'start' as const,
  taskMode: 'chat' as const,
})

type SeededTurn = { turnID: string; agentID: string; inputID: string }

const seedTurn = (
  db: AgentDatabase,
  threadID: string,
  index: number,
  createdAt: number,
  toolOutput?: string,
): SeededTurn => {
  const created = db.createTurn(threadID, submitInput(`第 ${index} 轮指令`), 'completed')
  db.updateTurnStatus(created.turnID, 'completed')
  db.sqlite
    .query('UPDATE turns SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(createdAt, createdAt, created.turnID)
  const putItem = (id: string, type: Item['type'], data: Record<string, unknown>) =>
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
  putItem(`reason-${index}`, 'reasoning', { text: `推理 ${index}` })
  putItem(`process-${index}`, 'text', { text: `过程文本 ${index}`, placement: 'process' })
  putItem(`answer-${index}`, 'text', { text: `最终答案 ${index}`, placement: 'result' })
  putItem(`plan-${index}`, 'plan', {
    title: `计划 ${index}`,
    markdown: `## 计划 ${index}\n- 步骤一\n- 步骤二`,
  })
  putItem(`tool-${index}`, 'tool', {
    tool: 'workspace.read',
    title: `读取文件 ${index}`,
    output: toolOutput ?? `文件内容 ${index}`,
  })
  return { turnID: created.turnID, agentID: created.agentID, inputID: created.inputID }
}

const seedConversation = (fixture: Fixture) => {
  const project = fixture.db.createProject({
    rootPath: join(fixture.root, 'project'),
    name: '测试项目',
  })
  const thread = fixture.db.createThread('分页会话', project.id)
  const base = 1_700_000_000_000
  const turns: SeededTurn[] = []
  for (let index = 1; index <= 12; index += 1) {
    const createdAt = base + index * 1000
    const hugeOutput =
      index === 12 ? `文件内容 ${index} ${'x'.repeat(9_000)} 超限尾部 ${index}` : undefined
    turns.push(seedTurn(fixture.db, thread.id, index, createdAt, hugeOutput))
  }
  return { project, thread, turns }
}

type ReadThreadEntry = {
  id: string
  turnId: string
  agentId?: string
  role: string
  kind: string
  status: string
  content: string
  createdAt: number
}

type ReadThreadOutput = {
  thread: {
    id: string
    title: string
    workspace: unknown
    createdAt: number
    updatedAt: number
  }
  entries: ReadThreadEntry[]
  hasOlder: boolean
  olderCursor: string | null
}

const CORE_TABLES = [
  'threads',
  'turns',
  'inputs',
  'messages',
  'items',
  'agent_executions',
  'approval_requests',
  'events',
] as const

const coreTablesSnapshot = (db: AgentDatabase) =>
  CORE_TABLES.reduce<Record<string, string>>((acc, table) => {
    const rows = db.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all()
    acc[table] = JSON.stringify(rows, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
    return acc
  }, {})

describe('read_thread 工具冻结行为', () => {
  test('以规范调用形状 read_thread({ thread_ref, before?, limit? }) 注册，并冻结可见性与只读元数据', async () => {
    const fixture = await makeFixture()
    const definition = fixture.readThreadDefinition
    expect(definition.sdkName).toBe('read_thread')
    expect(fixture.executor.definition('read_thread').sdkName).toBe('read_thread')
    const properties = Object.keys(
      (definition.inputSchema.properties ?? {}) as Record<string, unknown>,
    ).sort()
    expect(properties).toEqual(['before', 'limit', 'thread_ref'])
    const required = (definition.inputSchema.required as string[] | undefined) ?? []
    expect(required).toContain('thread_ref')
    expect(required).not.toContain('before')
    expect(required).not.toContain('limit')
    expect([...definition.allowedModes].sort()).toEqual(['chat', 'plan'])
    expect(definition.allowedProfiles).toEqual(
      expect.arrayContaining(['main', 'worker', 'explorer']),
    )
    expect(definition.executionMode).toBe('parallel')
    expect(definition.approvalStrategy).toBe('never-review')
    expect(definition.capabilities).toEqual({
      filesystem: 'none',
      network: 'none',
      process: false,
      externalState: false,
      userInteraction: false,
    })
  })

  test('原始 thread ID 与 buildThreadDeepLink 深链读取结果一致，解析走共享模块', async () => {
    const fixture = await makeFixture()
    const { thread } = seedConversation(fixture)
    const deepLink = buildThreadDeepLink(thread.id)
    expect(resolveThreadReference(deepLink)).toBe(thread.id)
    expect(resolveThreadReference(thread.id)).toBe(thread.id)
    expect(resolveThreadReference('pidex://threads/')).toBeNull()

    const byRaw = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id },
      contextFor(fixture),
    )
    const byLink = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: deepLink },
      contextFor(fixture),
    )
    expect(byLink).toEqual(byRaw)
  })

  test('默认读取最新 10 个 turn 而非 10 条 entry，并返回冻结的 thread/entry 形状', async () => {
    const fixture = await makeFixture()
    const { thread, turns, project } = seedConversation(fixture)
    const page = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id },
      contextFor(fixture),
    )

    expect(page.thread.id).toBe(thread.id)
    expect(page.thread.title).toBe('分页会话')
    expect(typeof page.thread.createdAt).toBe('number')
    expect(typeof page.thread.updatedAt).toBe('number')
    expect(page.thread.workspace).toMatchObject({ kind: 'project', projectID: project.id })
    expect(Object.keys(page.thread).sort()).toEqual([
      'createdAt',
      'id',
      'title',
      'updatedAt',
      'workspace',
    ])

    expect(page.hasOlder).toBe(true)
    expect(page.olderCursor).toBeString()

    const turnIds = new Set(page.entries.map((entry) => entry.turnId))
    expect(turnIds.size).toBe(10)
    expect(page.entries.length).toBeGreaterThan(10)
    expect(turnIds).toEqual(new Set(turns.slice(2).map((turn) => turn.turnID)))
    expect(turnIds.has(turns[0]!.turnID)).toBe(false)
    expect(turnIds.has(turns[1]!.turnID)).toBe(false)

    const userEntries = page.entries.filter((entry) => entry.role === 'user')
    const toolEntries = page.entries.filter((entry) => entry.kind === 'tool')
    expect(userEntries).toHaveLength(10)
    expect(toolEntries).toHaveLength(10)
    for (const entry of page.entries) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.turnId).toBe('string')
      expect(typeof entry.status).toBe('string')
      expect(typeof entry.content).toBe('string')
      expect(typeof entry.createdAt).toBe('number')
      if (entry.role === 'user') {
        expect(entry.agentId).toBeUndefined()
      } else {
        expect(typeof entry.agentId).toBe('string')
      }
      expect(Object.keys(entry).sort()).toEqual(entryKeys(entry.role))
    }
  })

  test('hasOlder=true 且 olderCursor 非空，翻页读取更早 turn 无重复且得到第 1–2 turn', async () => {
    const fixture = await makeFixture()
    const { thread, turns } = seedConversation(fixture)
    const first = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id },
      contextFor(fixture),
    )
    expect(first.hasOlder).toBe(true)
    expect(first.olderCursor).toBeString()

    const older = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id, before: first.olderCursor! },
      contextFor(fixture),
    )
    expect(older.hasOlder).toBe(false)
    expect(older.olderCursor).toBeNull()

    const olderIds = new Set(older.entries.map((entry) => entry.turnId))
    expect(olderIds).toEqual(new Set([turns[0]!.turnID, turns[1]!.turnID]))
    const firstIds = new Set(first.entries.map((entry) => entry.turnId))
    expect([...olderIds].some((id) => firstIds.has(id))).toBe(false)
  })

  test('limit 参数控制返回的 turn 数量上限', async () => {
    const fixture = await makeFixture()
    const { thread, turns } = seedConversation(fixture)
    const page = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id, limit: 4 },
      contextFor(fixture),
    )
    const turnIds = new Set(page.entries.map((entry) => entry.turnId))
    expect(turnIds).toEqual(new Set(turns.slice(8).map((turn) => turn.turnID)))
  })

  test('返回用户消息、助手结果、plan Markdown 与受限工具摘要，排除 reasoning 与 process 文本', async () => {
    const fixture = await makeFixture()
    const { thread, turns } = seedConversation(fixture)
    const page = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id },
      contextFor(fixture),
    )
    const all = page.entries.map((entry) => entry.content).join('\n')

    for (let index = 3; index <= 12; index += 1) {
      expect(all).toContain(`第 ${index} 轮指令`)
      expect(all).toContain(`最终答案 ${index}`)
      expect(all).toContain(`## 计划 ${index}`)
      expect(all).toContain(`读取文件 ${index}`)
      expect(all).toContain(`文件内容 ${index}`)
    }

    const third = turns[2]!
    expect(
      page.entries.find((entry) => entry.kind === 'message' && entry.turnId === third.turnID)
        ?.content,
    ).toBe('第 3 轮指令')
    expect(
      page.entries.find((entry) => entry.kind === 'text' && entry.turnId === third.turnID)?.content,
    ).toBe('最终答案 3')
    expect(
      page.entries.find((entry) => entry.kind === 'plan' && entry.turnId === third.turnID)?.content,
    ).toBe('## 计划 3\n- 步骤一\n- 步骤二')
    expect(
      page.entries.find((entry) => entry.kind === 'tool' && entry.turnId === third.turnID)?.content,
    ).toContain('读取文件 3')

    expect(all).not.toContain('推理')
    expect(all).not.toContain('过程文本')
    expect(page.entries.some((entry) => entry.content.includes('推理'))).toBe(false)

    const newestTool = page.entries.find(
      (entry) => entry.kind === 'tool' && entry.turnId === turns.at(-1)!.turnID,
    )
    expect(newestTool).toBeDefined()
    expect(newestTool!.content.length).toBeLessThanOrEqual(4000)
    expect(newestTool!.content).toContain('读取文件 12')
    expect(newestTool!.content).toContain('文件内容 12')
    expect(newestTool!.content).not.toContain('超限尾部 12')
    expect(
      page.entries.find((entry) => entry.kind === 'tool' && entry.turnId === third.turnID)?.content,
    ).toContain('文件内容 3')
  })

  test('archived_at 非空的归档会话仍可读', async () => {
    const fixture = await makeFixture()
    const { db, history } = fixture
    const project = db.createProject({
      rootPath: join(fixture.root, 'archived-project'),
      name: '归档项目',
    })
    const thread = db.createThread('归档会话', project.id)
    const turn = db.createTurn(thread.id, submitInput('归档中的指令'), 'completed')
    db.updateTurnStatus(turn.turnID, 'completed')
    db.upsertItem(thread.id, {
      id: 'archived-answer',
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'text',
      status: 'completed',
      data: { text: '归档回答正文', placement: 'result' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await history.patch(thread.id, { archived: true })
    const archivedAt = (
      db.sqlite.query('SELECT archived_at FROM threads WHERE id = ?').get(thread.id) as {
        archived_at: number | null
      }
    ).archived_at
    expect(archivedAt).not.toBeNull()

    const page = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id },
      contextFor(fixture),
    )
    expect(page.thread.id).toBe(thread.id)
    expect(page.thread.title).toBe('归档会话')
    expect(page.entries.some((entry) => entry.content === '归档回答正文')).toBe(true)
  })

  test('不存在 ID 返回安全 THREAD_NOT_FOUND，不回显输入或泄露路径/SQL/原始异常', async () => {
    const fixture = await makeFixture()
    const missing = `missing-thread-${crypto.randomUUID()}`
    const error = await fixture.executor
      .execute<ReadThreadOutput>('read_thread', { thread_ref: missing }, contextFor(fixture))
      .then(
        () => null,
        (cause) => cause,
      )
    expect(error).toBeInstanceOf(AgentError)
    if (!(error instanceof AgentError)) throw error
    expect(error.code).toBe('THREAD_NOT_FOUND')
    const serialized = JSON.stringify({ message: error.message, details: error.details })
    expect(serialized).not.toContain(missing)
    expect(serialized).not.toContain(fixture.databasePath)
    expect(serialized).not.toContain('SELECT')
    expect(serialized).not.toContain('sqlite')
  })

  test('调用前后事件数、data_version 与核心表内容不变，证明工具纯只读', async () => {
    const fixture = await makeFixture()
    const { thread } = seedConversation(fixture)
    const eventsBefore = fixture.db.eventsAfter(0).length
    const dataVersionBefore = (
      fixture.db.sqlite.query('PRAGMA data_version').get() as { data_version: number }
    ).data_version
    const snapshotBefore = coreTablesSnapshot(fixture.db)

    const page = await fixture.executor.execute<ReadThreadOutput>(
      'read_thread',
      { thread_ref: thread.id },
      contextFor(fixture),
    )
    expect(page.entries.length).toBeGreaterThan(0)

    expect(fixture.db.eventsAfter(0).length).toBe(eventsBefore)
    expect(
      (fixture.db.sqlite.query('PRAGMA data_version').get() as { data_version: number })
        .data_version,
    ).toBe(dataVersionBefore)
    expect(coreTablesSnapshot(fixture.db)).toEqual(snapshotBefore)
  })
})

/**
 * entry 精确键契约：user 消息不含 agentId，其余 entry 必须携带 agentId；
 * 实现不得附带 truncated/metadata/raw 等计划外字段泄漏内部数据。
 */
const entryKeys = (role: string) =>
  role === 'user'
    ? ['content', 'createdAt', 'id', 'kind', 'role', 'status', 'turnId']
    : ['agentId', 'content', 'createdAt', 'id', 'kind', 'role', 'status', 'turnId']
