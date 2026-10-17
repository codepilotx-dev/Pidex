import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { SessionGroupRepository } from '../src/storage/repositories/SessionGroupRepository'
import { SubagentRepository } from '../src/subagent/SubagentRepository'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { TaskExecutionBindingService } from '../src/worktree/TaskExecutionBindingService'
import { WorktreeRepository } from '../src/worktree/WorktreeRepository'
import { removeFixturePaths } from './FixtureCleanup'

const model = Model.Ref.make({
  providerID: Provider.ID.make('openai'),
  id: Model.ID.make('fixture'),
})
const permission = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-execution-env-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const bindings = new TaskExecutionBindingService(new WorktreeRepository(db.sqlite))
  return { db, bindings, projection: new ThreadProjection(db), root }
}

const listItem = (db: AgentDatabase, threadId: string) => {
  const projection = new ThreadProjection(db)
  return projection.list({}).find((item) => item.id === threadId)
}

const insertWorktree = (
  db: AgentDatabase,
  input: {
    id: string
    path: string
    branchName?: string | null
    status?: string
    environmentRevision?: number
    root: string
  },
) => {
  db.sqlite
    .query(
      `
    INSERT INTO managed_worktrees
      (id, project_id, repository_root, path, status, branch_name, base_commit, head_commit,
       setup_status, environment_revision, continued_without_setup, created_at, updated_at, last_used_at)
    VALUES (?, 'project:1', ?, ?, ?, ?, 'base', 'head', 'succeeded', ?, 0, 1, 1, 1)
  `,
    )
    .run(
      input.id,
      input.root,
      input.path,
      input.status ?? 'ready',
      input.branchName ?? null,
      input.environmentRevision ?? 0,
    )
}

/** Binds a worktree without going through readiness validation, to isolate projection behavior. */
const bindWorktreeDirectly = (
  db: AgentDatabase,
  threadId: string,
  worktreeId: string,
  cwd: string,
) => {
  db.sqlite
    .query(
      `
    INSERT INTO thread_execution_bindings
      (thread_id, binding_id, kind, project_id, cwd, worktree_id, revision, environment_revision, created_at, updated_at)
    VALUES (?, ?, 'worktree', 'project:1', ?, ?, 1, 0, 1, 1)
  `,
    )
    .run(threadId, `binding:${worktreeId}`, cwd, worktreeId)
}

describe('Thread execution environment projection', () => {
  test('归档列表 cursor 完整读取同更新时间的多页记录，并明确提供本地来源', async () => {
    const { db, projection } = await fixture()
    const created = Array.from({ length: 5 }, (_, index) => db.createThread(`归档 ${index}`))
    for (const thread of created)
      db.sqlite
        .query('UPDATE threads SET archived_at = 1, updated_at = 100 WHERE id = ?')
        .run(thread.id)
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = projection.listPage({ archived: true, limit: 2, ...(cursor ? { cursor } : {}) })
      expect(page.threads.every((thread) => thread.storageSource === 'local')).toBe(true)
      ids.push(...page.threads.map((thread) => thread.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(new Set(ids).size).toBe(5)
    expect(ids).toHaveLength(5)
    expect(() => projection.listPage({ cursor: 'invalid' })).toThrow()
    db.close()
  })
  test('无权威 workspace 的旧 Thread 省略 executionEnvironment', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread('无工作区线程')

    expect(db.threadWorkspace(thread.id)).toBeNull()
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toBeUndefined()
    expect(listItem(db, thread.id)?.executionEnvironment).toBeUndefined()
    expect(projection.snapshot(thread.id)?.thread.workflowId ?? null).toBeNull()
    db.close()
  })

  test('无 binding 的 projectless Thread 按权威 workspace 投影 Local', async () => {
    const { db, projection, root } = await fixture()
    const cwd = join(root, 'projectless')
    const thread = db.createThread({
      title: '无项目线程',
      workspace: {
        kind: 'projectless',
        workspaceRoot: root,
        cwd,
        outputDirectory: join(root, 'outputs'),
      },
    })

    const expected = { kind: 'local' as const, cwd: resolve(cwd), revision: 1 }
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toEqual(expected)
    expect(listItem(db, thread.id)?.executionEnvironment).toEqual(expected)
    db.close()
  })

  test('无 binding 的项目 Thread 按项目根目录投影 Local', async () => {
    const { db, projection, root } = await fixture()
    const project = db.createProject({ rootPath: join(root, 'project'), name: '测试项目' })
    const thread = db.createThread('项目线程', project.id)

    const projectCwd = db.threadWorkspace(thread.id)?.cwd ?? ''
    expect(projectCwd).not.toBe('')
    const environment = projection.snapshot(thread.id)?.thread.executionEnvironment
    expect(environment).toEqual({ kind: 'local', cwd: projectCwd, revision: 1 })
    expect(listItem(db, thread.id)?.executionEnvironment).toEqual(environment)
    db.close()
  })

  test('子 Agent child Thread 按工作区归属线程投影执行环境', async () => {
    const { db, projection, root } = await fixture()
    const project = db.createProject({ rootPath: join(root, 'project'), name: '测试项目' })
    const thread = db.createThread('项目线程', project.id)
    const worktreePath = join(root, 'worktree')
    insertWorktree(db, { id: 'worktree:1', path: worktreePath, root })
    bindWorktreeDirectly(db, thread.id, 'worktree:1', worktreePath)

    const parentEnvironment = projection.snapshot(thread.id)?.thread.executionEnvironment
    expect(parentEnvironment).toMatchObject({ kind: 'worktree', cwd: resolve(worktreePath) })

    const turn = db.createTurn(thread.id, {
      content: 'root',
      model,
      permissionConfig: permission,
      strategy: 'queue',
      taskMode: 'chat',
    })
    const child = new SubagentRepository(db).create({
      parentThreadID: thread.id,
      parentTurnID: turn.turnID,
      parentAgentID: turn.agentID,
      displayName: 'Explorer 1',
      profile: 'explorer',
      task: '审计实现',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: worktreePath,
    })

    // 子 Agent 没有自己的绑定行：必须复用父线程的 worktree 绑定，
    // 而不是退回描述符里的项目根目录。
    expect(projection.snapshot(child.task.childThreadId)?.thread.executionEnvironment).toEqual(
      parentEnvironment,
    )
    db.close()
  })

  test('本地绑定投影 kind/cwd/revision', async () => {
    const { db, bindings, projection, root } = await fixture()
    const thread = db.createThread('本地线程')
    bindings.bindLocal({ threadId: thread.id, projectId: null, cwd: root })

    const environment = { kind: 'local' as const, cwd: resolve(root), revision: 1 }
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toEqual(environment)
    expect(listItem(db, thread.id)?.executionEnvironment).toEqual(environment)
    db.close()
  })

  test('托管 worktree 绑定投影 worktreeId、分支与状态', async () => {
    const { db, bindings, projection, root } = await fixture()
    const thread = db.createThread('工作树线程')
    const worktreePath = resolve(root, 'worktree')
    insertWorktree(db, {
      id: 'worktree:1',
      path: worktreePath,
      branchName: 'codex/execution-env',
      root: resolve(root),
    })

    bindings.bindWorktree({ threadId: thread.id, projectId: 'project:1', worktreeId: 'worktree:1' })

    const expected = {
      kind: 'worktree' as const,
      worktreeId: 'worktree:1',
      cwd: worktreePath,
      branchName: 'codex/execution-env',
      status: 'ready' as const,
      revision: 1,
    }
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toEqual(expected)
    expect(listItem(db, thread.id)?.executionEnvironment).toEqual(expected)
    db.close()
  })

  test('未来 schema 的未知 worktree 状态省略该投影而不使 thread 读取失败', async () => {
    const { db, projection, root } = await fixture()
    // 有真实 workspace，若错误地回退到 workspace 就会投影出 Local。
    const thread = db.createThread({
      title: '未来状态线程',
      workspace: {
        kind: 'projectless',
        workspaceRoot: root,
        cwd: join(root, 'future'),
        outputDirectory: join(root, 'outputs'),
      },
    })
    insertWorktree(db, {
      id: 'worktree:future',
      path: join(root, 'future-worktree'),
      root: resolve(root),
    })
    bindWorktreeDirectly(db, thread.id, 'worktree:future', resolve(root))

    // A newer writer may persist a status this build does not know.
    db.sqlite.exec('PRAGMA ignore_check_constraints = ON')
    db.sqlite
      .query("UPDATE managed_worktrees SET status = 'reconciling' WHERE id = 'worktree:future'")
      .run()
    db.sqlite.exec('PRAGMA ignore_check_constraints = OFF')

    // 省略该投影，而不是回退成 workspace Local；读取本身仍然成功。
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toBeUndefined()
    expect(listItem(db, thread.id)?.executionEnvironment).toBeUndefined()
    db.close()
  })

  test('绑定行存在但 revision 非法时省略该投影而非回退', async () => {
    const { db, projection, root } = await fixture()
    const thread = db.createThread({
      title: '非法 revision 线程',
      workspace: {
        kind: 'projectless',
        workspaceRoot: root,
        cwd: join(root, 'p'),
        outputDirectory: join(root, 'o'),
      },
    })
    db.sqlite
      .query(
        `
      INSERT INTO thread_execution_bindings (thread_id, binding_id, kind, project_id, cwd, worktree_id, revision, environment_revision, created_at, updated_at)
      VALUES (?, 'binding:bad', 'local', NULL, ?, NULL, 0, 0, 1, 1)
    `,
      )
      .run(thread.id, resolve(root))

    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toBeUndefined()
    expect(listItem(db, thread.id)?.executionEnvironment).toBeUndefined()
    db.close()
  })

  test('Local binding 不依赖 managed_worktrees，缺失时仍以 binding cwd 为权威', async () => {
    const { db, bindings, projection, root } = await fixture()
    const cwd = join(root, 'partial')
    const thread = db.createThread({
      title: '部分 schema 线程',
      workspace: {
        kind: 'projectless',
        workspaceRoot: root,
        cwd: join(root, 'workspace'),
        outputDirectory: join(root, 'outputs'),
      },
    })
    bindings.bindLocal({ threadId: thread.id, projectId: null, cwd })

    db.sqlite.exec('DROP TABLE managed_worktrees')

    // binding 行可读时以 binding 的 cwd 投影 Local，而不是回退到 workspace。
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toEqual({
      kind: 'local',
      cwd: resolve(cwd),
      revision: 1,
    })
    expect(listItem(db, thread.id)?.executionEnvironment).toEqual({
      kind: 'local',
      cwd: resolve(cwd),
      revision: 1,
    })
    db.close()
  })

  test('Worktree binding 在 managed_worktrees 缺失时省略投影而不误报 Local', async () => {
    const { db, projection, root } = await fixture()
    // 有真实 workspace，若错误地回退到 workspace 就会投影出 Local。
    const thread = db.createThread({
      title: '无 worktree 表线程',
      workspace: {
        kind: 'projectless',
        workspaceRoot: root,
        cwd: join(root, 'future'),
        outputDirectory: join(root, 'outputs'),
      },
    })
    insertWorktree(db, {
      id: 'worktree:orphan',
      path: join(root, 'orphan-worktree'),
      root: resolve(root),
    })
    bindWorktreeDirectly(db, thread.id, 'worktree:orphan', resolve(root))

    db.sqlite.exec('PRAGMA foreign_keys = OFF')
    db.sqlite.exec('DROP TABLE managed_worktrees')
    db.sqlite.exec('PRAGMA foreign_keys = ON')

    // Worktree binding 无法完整解析时必须省略，禁止错报成 Local。
    expect(projection.snapshot(thread.id)?.thread.executionEnvironment).toBeUndefined()
    expect(listItem(db, thread.id)?.executionEnvironment).toBeUndefined()
    db.close()
  })

  test('workflowId 与保留的 sessionGroupId 读取字段保持一致', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread('工作流线程')
    const groups = new SessionGroupRepository(db)
    const group = groups.create({ name: '登录修复' })
    groups.setMembership(thread.id, group.id)

    const snapshot = projection.snapshot(thread.id)?.thread
    expect(snapshot?.workflowId).toBe(group.id)
    expect(snapshot?.sessionGroupId).toBe(group.id)
    const item = listItem(db, thread.id)
    expect(item?.workflowId).toBe(group.id)
    expect(item?.sessionGroupId).toBe(group.id)
    db.close()
  })
})
