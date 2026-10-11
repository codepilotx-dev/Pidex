import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ThreadMessageForkRepository } from '../src/session/fork/ThreadMessageForkRepository'
import { ThreadMessageForkService } from '../src/session/fork/ThreadMessageForkService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { WorktreeRepository } from '../src/worktree/WorktreeRepository'
import type { ManagedWorktree, WorktreeOperation } from '../src/worktree/Types'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(roots.splice(0))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-message-fork-service-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  databases.push(db)
  return { root, db, worktrees: new WorktreeRepository(db.sqlite) }
}

const insertTurn = (
  db: AgentDatabase,
  input: {
    threadID: string
    turnID: string
    itemID: string
    status: 'completed' | 'running'
    createdAt: number
  },
) => {
  const agentID = `agent-${input.turnID}`
  db.sqlite
    .query(
      `INSERT INTO turns (
    id, thread_id, root_agent_id, status, mode, model_ref, strategy, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'chat', '{}', 'start', ?, ?)`,
    )
    .run(input.turnID, input.threadID, agentID, input.status, input.createdAt, input.createdAt)
  db.sqlite
    .query(
      `INSERT INTO agent_executions (
    id, thread_id, turn_id, profile, task, model_ref, session_id, status, created_at, updated_at
  ) VALUES (?, ?, ?, 'main', 'task', '{}', ?, ?, ?, ?)`,
    )
    .run(
      agentID,
      input.threadID,
      input.turnID,
      `session-${input.turnID}`,
      input.status,
      input.createdAt,
      input.createdAt,
    )
  db.sqlite
    .query(
      `INSERT INTO items (
    id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'text', ?, ?, 0, ?, ?)`,
    )
    .run(
      input.itemID,
      input.threadID,
      input.turnID,
      agentID,
      input.status,
      JSON.stringify({ placement: 'result', text: `answer-${input.turnID}` }),
      input.createdAt,
      input.createdAt,
    )
}

const operation = (
  operationId: string,
  worktreeId: string,
  projectId: string,
): WorktreeOperation => ({
  operationId,
  worktreeId,
  projectId,
  kind: 'create',
  requestHash: 'safe-hash',
  step: 'complete',
  status: 'completed',
  revision: 1,
  errorCode: null,
  warnings: [],
  createdAt: 1,
  updatedAt: 1,
  completedAt: 1,
})

const waitForTerminal = async (service: ThreadMessageForkService, operationID: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = (await service.status(operationID)).operation
    if (current.status !== 'running') return current
    await Bun.sleep(10)
  }
  throw new Error('fork operation did not terminalize')
}

describe('ThreadMessageForkService', () => {
  test('无效分叉点返回安全应用错误且不创建 operation', async () => {
    const { db, worktrees } = await fixture()
    const operations = new ThreadMessageForkRepository(db, () => 10)
    const service = new ThreadMessageForkService(
      operations,
      {} as never,
      {} as never,
      {} as never,
      worktrees,
    )

    let error: unknown
    try {
      await service.start({
        operationID: 'invalid-fork-point',
        sourceThreadID: 'missing-thread',
        sourceTurnID: 'missing-turn',
        sourceItemID: 'missing-item',
        destination: { kind: 'same-worktree' },
      })
    } catch (cause) {
      error = cause
    }

    expect(error).toMatchObject({
      code: 'FORK_POINT_NOT_FOUND',
      message: '分叉消息不存在',
      status: 404,
    })
    expect(operations.find('invalid-fork-point')).toBeNull()
    expect(
      db.sqlite.query('SELECT COUNT(*) AS count FROM thread_message_fork_operations').get(),
    ).toEqual({ count: 0 })
  })

  test('源任务存在后续运行 turn 时仍从已完成回复分叉，且同一请求幂等复用目标', async () => {
    const { db, worktrees } = await fixture()
    const source = db.createThread('source')
    insertTurn(db, {
      threadID: source.id,
      turnID: 'completed-turn',
      itemID: 'completed-item',
      status: 'completed',
      createdAt: 1,
    })
    insertTurn(db, {
      threadID: source.id,
      turnID: 'active-turn',
      itemID: 'active-item',
      status: 'running',
      createdAt: 2,
    })
    let forkCalls = 0
    let bindCalls = 0
    const target = db.createThread('target')
    const service = new ThreadMessageForkService(
      new ThreadMessageForkRepository(db, () => 10),
      {
        forkThrough: async () => {
          forkCalls += 1
          return { targetThreadID: target.id }
        },
        publishTarget: () => true,
        rollback: () => false,
      } as never,
      {
        source: async () => ({
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          runtimeWorkspaceRoots: [],
          executionBinding: { bindingId: 'source-binding' },
        }),
        targetWorkspace: () => ({ cwd: 'C:\\workspace', roots: '[]', gitBranch: '' }),
        bindSame: async () => {
          bindCalls += 1
          return 'target-binding'
        },
        removeEnvironment: async () => undefined,
      } as never,
      {} as never,
      worktrees,
    )
    const request = {
      operationID: 'same-operation',
      sourceThreadID: source.id,
      sourceTurnID: 'completed-turn',
      sourceItemID: 'completed-item',
      destination: { kind: 'same-worktree' as const },
    }

    const started = await service.start(request)
    expect(started.status).toBe('running')
    const first = await waitForTerminal(service, request.operationID)
    const replay = await service.start(request)

    expect(first).toMatchObject({
      status: 'completed',
      snapshotMode: 'shared',
      targetThreadId: target.id,
    })
    expect(replay.targetThreadId).toBe(target.id)
    expect(forkCalls).toBe(1)
    expect(bindCalls).toBe(1)
    expect(service.pending(source.id, 'completed-turn', 'completed-item')?.targetThreadId).toBe(
      target.id,
    )
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = 'active-turn'").get()).toEqual({
      status: 'running',
    })
    db.sqlite.query('DELETE FROM threads WHERE id = ?').run(target.id)
    expect(service.pending(source.id, 'completed-turn', 'completed-item')).toBeNull()
  })

  test('同一回复已有进行中的 operation 时稳定返回冲突', async () => {
    const { db } = await fixture()
    const source = db.createThread('source')
    insertTurn(db, {
      threadID: source.id,
      turnID: 'completed-turn',
      itemID: 'completed-item',
      status: 'completed',
      createdAt: 1,
    })
    const repository = new ThreadMessageForkRepository(db, () => 10)
    const request = {
      sourceThreadID: source.id,
      sourceTurnID: 'completed-turn',
      sourceItemID: 'completed-item',
      destinationKind: 'same-worktree' as const,
    }
    repository.create({
      operationID: 'first-operation',
      ...request,
      requestHash: ThreadMessageForkRepository.requestHash(request),
    })

    let error: unknown
    try {
      repository.create({
        operationID: 'second-operation',
        ...request,
        requestHash: ThreadMessageForkRepository.requestHash(request),
      })
    } catch (cause) {
      error = cause
    }
    expect(error).toMatchObject({ code: 'FORK_OPERATION_CONFLICT', status: 409 })
    expect(repository.find('second-operation')).toBeNull()
  })

  test('源任务运行时的新 worktree 固定使用 HEAD 快照，并在子 operation 已存在后建立关联', async () => {
    const { root, db, worktrees } = await fixture()
    const project = db.createProject({ id: 'project', rootPath: root, name: 'Project' })
    const source = db.createThread('source', project.id)
    insertTurn(db, {
      threadID: source.id,
      turnID: 'completed-turn',
      itemID: 'completed-item',
      status: 'completed',
      createdAt: 1,
    })
    insertTurn(db, {
      threadID: source.id,
      turnID: 'active-turn',
      itemID: 'active-item',
      status: 'running',
      createdAt: 2,
    })
    const target = db.createThread('target', project.id)
    const managed: ManagedWorktree = {
      id: 'managed-worktree',
      projectId: project.id,
      repositoryRoot: root,
      path: join(root, 'managed'),
      status: 'ready',
      branchName: null,
      baseCommit: 'head',
      headCommit: 'head',
      permanent: false,
      pinned: false,
      boundOnce: false,
      setupStatus: 'succeeded',
      environmentRevision: 0,
      continuedWithoutSetup: false,
      restoreSnapshotPath: null,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: 1,
      deletedAt: null,
    }
    let createInput: Record<string, unknown> | null = null
    const service = new ThreadMessageForkService(
      new ThreadMessageForkRepository(db, () => 10),
      {
        forkThrough: async () => ({ targetThreadID: target.id }),
        publishTarget: () => true,
        rollback: () => false,
      } as never,
      {
        source: async () => ({
          kind: 'project',
          projectID: project.id,
          workspaceRoot: root,
          cwd: root,
          runtimeWorkspaceRoots: [{ folderId: 'primary', path: root, role: 'primary' }],
          executionBinding: { bindingId: 'source-binding' },
        }),
        targetWorkspace: (_source: unknown, cwd: string) => ({
          cwd,
          roots: '[]',
          gitBranch: 'feature',
        }),
        bindNewWorktree: async () => 'target-binding',
        removeEnvironment: async () => undefined,
      } as never,
      {
        create: async (input: Record<string, unknown>) => {
          createInput = input
          worktrees.insertWorktree(managed)
          const child = operation(String(input.operationId), managed.id, project.id)
          worktrees.insertOperation(child)
          return {
            worktree: managed,
            operation: child,
            output: { cursor: 0, data: '', truncated: false, complete: true },
          }
        },
      } as never,
      worktrees,
    )

    const started = await service.start({
      operationID: 'worktree-operation',
      sourceThreadID: source.id,
      sourceTurnID: 'completed-turn',
      sourceItemID: 'completed-item',
      destination: { kind: 'new-worktree' },
    })
    expect(started.status).toBe('running')
    const result = await waitForTerminal(service, 'worktree-operation')

    expect(createInput).toMatchObject({ sourceWorkspacePath: root, snapshotMode: 'head' })
    expect(result).toMatchObject({
      status: 'completed',
      snapshotMode: 'head',
      targetWorktreeId: managed.id,
    })
    expect(
      db.sqlite
        .query(
          'SELECT worktree_operation_id FROM thread_message_fork_operations WHERE operation_id = ?',
        )
        .get('worktree-operation'),
    ).toEqual({ worktree_operation_id: 'worktree-operation:create' })
  })

  test('setup 失败后按 revision 重试成功，并复用同一 worktree 创建唯一目标', async () => {
    const { root, db, worktrees } = await fixture()
    const project = db.createProject({ id: 'retry-project', rootPath: root, name: 'Project' })
    const source = db.createThread('source', project.id)
    insertTurn(db, {
      threadID: source.id,
      turnID: 'completed-turn',
      itemID: 'completed-item',
      status: 'completed',
      createdAt: 1,
    })
    const target = db.createThread('target', project.id)
    const failed: ManagedWorktree = {
      id: 'retry-worktree',
      projectId: project.id,
      repositoryRoot: root,
      path: join(root, 'managed-retry'),
      status: 'ready-with-setup-error',
      branchName: null,
      baseCommit: 'head',
      headCommit: 'head',
      permanent: false,
      pinned: false,
      boundOnce: false,
      setupStatus: 'failed',
      environmentRevision: 0,
      continuedWithoutSetup: false,
      restoreSnapshotPath: null,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: 1,
      deletedAt: null,
    }
    let forkCalls = 0
    let retrySourcePath: string | undefined
    const service = new ThreadMessageForkService(
      new ThreadMessageForkRepository(db, () => 10),
      {
        forkThrough: async () => {
          forkCalls += 1
          return { targetThreadID: target.id }
        },
        publishTarget: () => true,
        rollback: () => false,
      } as never,
      {
        source: async () => ({
          kind: 'project',
          projectID: project.id,
          workspaceRoot: root,
          cwd: root,
          runtimeWorkspaceRoots: [{ folderId: 'primary', path: root, role: 'primary' }],
          executionBinding: { bindingId: 'source-binding' },
        }),
        targetWorkspace: (_source: unknown, cwd: string) => ({
          cwd,
          roots: '[]',
          gitBranch: 'feature',
        }),
        bindNewWorktree: async () => 'target-binding',
        removeEnvironment: async () => undefined,
      } as never,
      {
        create: async (input: Record<string, unknown>) => {
          worktrees.insertWorktree(failed)
          const child = operation(String(input.operationId), failed.id, project.id)
          worktrees.insertOperation(child)
          return {
            worktree: failed,
            operation: child,
            output: { cursor: 0, data: '', truncated: false, complete: true },
          }
        },
        retrySetup: async (input: Record<string, unknown>) => {
          retrySourcePath = input.sourceWorkspacePath as string
          const ready = worktrees.updateWorktree(failed.id, {
            status: 'ready',
            setupStatus: 'succeeded',
            updatedAt: 2,
          })!
          const child = {
            ...operation(String(input.operationId), failed.id, project.id),
            kind: 'retry-setup' as const,
          }
          worktrees.insertOperation(child)
          return {
            worktree: ready,
            operation: child,
            output: { cursor: 0, data: '', truncated: false, complete: true },
          }
        },
      } as never,
      worktrees,
    )

    await service.start({
      operationID: 'retry-operation',
      sourceThreadID: source.id,
      sourceTurnID: 'completed-turn',
      sourceItemID: 'completed-item',
      destination: { kind: 'new-worktree' },
    })
    const awaiting = await waitForTerminal(service, 'retry-operation')
    const retrying = await service.retrySetup('retry-operation', awaiting.revision)
    expect(retrying.status).toBe('running')
    const completed = await waitForTerminal(service, 'retry-operation')

    expect(awaiting).toMatchObject({
      status: 'awaiting-setup-decision',
      snapshotMode: 'working-tree',
    })
    expect(completed).toMatchObject({
      status: 'completed',
      targetWorktreeId: failed.id,
      targetThreadId: target.id,
    })
    expect(retrySourcePath).toBe(root)
    expect(forkCalls).toBe(1)
  })
})
