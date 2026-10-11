import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentError } from '../src/Domain'
import { GitHandoffCoordinator, type HandoffGitRunner } from '../src/handoff/GitHandoffCoordinator'
import { HANDOFF_STEPS, HandoffRepository } from '../src/handoff/HandoffRepository'
import {
  HandoffService,
  type HandoffLifecyclePort,
  type HandoffWorkspacePort,
} from '../src/handoff/HandoffService'
import { HandoffLifecycle } from '../src/handoff/HandoffLifecycle'
import { BindingHandoffWorkspace } from '../src/handoff/BindingHandoffWorkspace'
import { ThreadForkRepository } from '../src/handoff/ThreadForkRepository'
import {
  SqlitePiSessionRepo,
  SqlitePiSessionStorage,
} from '../src/storage/pi-session/SqlitePiSession'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { EnvironmentDeltaStore } from '../src/local-environment/EnvironmentDeltaStore'
import { TaskExecutionBindingService } from '../src/worktree/TaskExecutionBindingService'
import { WorktreeRepository } from '../src/worktree/WorktreeRepository'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const database = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-handoff-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  return db
}

describe('Conversation fork 与 Handoff 可见性', () => {
  test('复制完整可继续历史但不复制运行态，ack 前在 active/archived list 都不可见', async () => {
    const db = await database()
    const source = db.createThread('source')
    const session = await new SqlitePiSessionRepo(db).create({
      id: 'session-source',
      threadID: source.id,
      agentID: 'agent-source',
    })
    await session.appendMessage({ role: 'user', content: 'persisted pi leaf', timestamp: 1 })
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    db.sqlite
      .query(
        `INSERT INTO turns (id, thread_id, root_agent_id, status, mode, model_ref, strategy, created_at, updated_at)
      VALUES ('turn-source', ?, 'agent-source', 'completed', 'chat', '{"providerID":"openai","id":"test"}', 'start', 1, 2)`,
      )
      .run(source.id)
    db.sqlite
      .query(
        `INSERT INTO agent_executions (id, thread_id, turn_id, profile, task, model_ref, session_id, status, created_at, updated_at)
      VALUES ('agent-source', ?, 'turn-source', 'main', 'task', '{"providerID":"openai","id":"test"}', 'session-source', 'completed', 1, 2)`,
      )
      .run(source.id)
    db.sqlite
      .query(
        `INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, strategy, task_mode, status, created_at)
      VALUES ('input-source', ?, 'turn-source', 'hello', '{"providerID":"openai","id":"test"}', 'start', 'chat', 'completed', 1)`,
      )
      .run(source.id)
    db.sqlite
      .query(
        "INSERT INTO messages (id, thread_id, turn_id, role, content, created_at, ordinal) VALUES ('message-source', ?, 'turn-source', 'user', 'hello', 1, 0)",
      )
      .run(source.id)
    db.sqlite
      .query(
        "INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at) VALUES ('item-source', ?, 'turn-source', 'agent-source', 'text', 'completed', ?, 0, 1, 2)",
      )
      .run(
        source.id,
        JSON.stringify({ text: 'answer', turnId: 'turn-source', agentId: 'agent-source' }),
      )
    db.sqlite
      .query(
        "INSERT INTO input_attachments (id, thread_id, input_id, kind, name, media_type, size_bytes, sha256, storage_path, created_at, bound_at) VALUES ('attachment-source', ?, 'input-source', 'text', 'note.txt', 'text/plain', 4, 'sha', 'sha', 1, 1)",
      )
      .run(source.id)

    const operations = new HandoffRepository(db, () => 100)
    operations.create({
      operationID: 'handoff-1',
      sourceThreadID: source.id,
      direction: 'local-to-worktree',
      destination: { kind: 'local' },
      requestHash: 'request',
    })
    const result = await new ThreadForkRepository(
      db,
      (() => {
        let id = 0
        return () => `fork-${++id}`
      })(),
    ).fork(source.id, {
      operationID: 'handoff-1',
      targetThreadID: 'target-thread',
      targetWorkspace: { cwd: 'C:\\managed\\target', roots: '[]', gitBranch: 'feature' },
    })
    expect(result.targetThreadID).toBe('target-thread')
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM events WHERE thread_id = 'target-thread'")
        .get(),
    ).toEqual({ count: 0 })
    expect(
      new ThreadProjection(db).list({ archived: false }).map((thread) => thread.id),
    ).not.toContain('target-thread')
    expect(
      new ThreadProjection(db).list({ archived: true }).map((thread) => thread.id),
    ).not.toContain('target-thread')

    const copied = db.sqlite
      .query("SELECT id, data FROM items WHERE thread_id = 'target-thread'")
      .get() as { id: string; data: string }
    expect(copied.id).not.toBe('item-source')
    expect(JSON.parse(copied.data)).toMatchObject({ text: 'answer' })
    const copiedAttachment = db.sqlite
      .query("SELECT id, storage_path FROM input_attachments WHERE thread_id = 'target-thread'")
      .get() as { id: string; storage_path: string }
    expect(copiedAttachment).toEqual({
      id: expect.not.stringMatching(/^attachment-source$/),
      storage_path: 'sha',
    })
    const copiedSession = db.sqlite
      .query("SELECT id FROM pi_sessions WHERE thread_id = 'target-thread'")
      .get() as { id: string }
    expect(
      (await new SqlitePiSessionRepo(db).openByID(copiedSession.id)).getEntries(),
    ).resolves.toHaveLength(1)
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM agent_checkpoints WHERE thread_id = 'target-thread'")
        .get(),
    ).toEqual({ count: 0 })

    for (const step of HANDOFF_STEPS.slice(1, 8)) operations.advance('handoff-1', step)
    operations.advance('handoff-1', 'transfer-core-state', { targetThreadID: 'target-thread' })
    const waiting = operations.advance('handoff-1', 'await-client-transfer')
    const completed = operations.completeAfterClientTransfer('handoff-1', waiting.revision)
    expect(completed.status).toBe('completed')
    expect(new ThreadProjection(db).list({ archived: false }).map((thread) => thread.id)).toContain(
      'target-thread',
    )
    expect(new ThreadProjection(db).list({ archived: true }).map((thread) => thread.id)).toContain(
      source.id,
    )
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE thread_id = 'target-thread' ORDER BY id")
        .all(),
    ).toEqual([{ method: 'thread/forked' }, { method: 'thread/handoff/completed' }])
    expect(operations.completeAfterClientTransfer('handoff-1', waiting.revision)).toEqual(completed)
  })

  test('失败回滚会恢复 review ownership 并移除隐藏 target', async () => {
    const db = await database()
    const source = db.createThread('source')
    const target = db.createThread('target')
    db.sqlite.query('UPDATE threads SET archived_at = -1 WHERE id = ?').run(target.id)
    const operations = new HandoffRepository(db)
    operations.create({
      operationID: 'handoff-rollback',
      sourceThreadID: source.id,
      direction: 'local-to-worktree',
      destination: { kind: 'local' },
      requestHash: 'request',
    })
    db.sqlite
      .query(
        "UPDATE thread_handoff_operations SET target_thread_id = ? WHERE operation_id = 'handoff-rollback'",
      )
      .run(target.id)
    db.sqlite
      .query(
        "INSERT INTO thread_forks (target_thread_id, source_thread_id, operation_id, created_at) VALUES (?, ?, 'handoff-rollback', 1)",
      )
      .run(target.id, source.id)
    new ThreadForkRepository(db).rollback('handoff-rollback')
    expect(db.sqlite.query('SELECT id FROM threads WHERE id = ?').get(target.id)).toBeNull()
    expect(
      db.sqlite
        .query(
          "SELECT target_thread_id FROM thread_handoff_operations WHERE operation_id = 'handoff-rollback'",
        )
        .get(),
    ).toEqual({ target_thread_id: null })
  })

  test('首事务 marker 隐藏未完成 fork，启动回滚可清理并用同一 target 重试', async () => {
    const db = await database()
    const source = db.createThread('source')
    const session = await new SqlitePiSessionRepo(db).create({
      id: 'crash-session',
      threadID: source.id,
      agentID: 'crash-agent',
    })
    await session.appendMessage({ role: 'user', content: 'fork crash', timestamp: 1 })
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    db.sqlite
      .query(
        `INSERT INTO turns (id, thread_id, root_agent_id, status, mode, model_ref, strategy, created_at, updated_at)
      VALUES ('crash-turn', ?, 'crash-agent', 'completed', 'chat', '{}', 'start', 1, 1)`,
      )
      .run(source.id)
    db.sqlite
      .query(
        `INSERT INTO agent_executions (id, thread_id, turn_id, profile, task, model_ref, session_id, status, created_at, updated_at)
      VALUES ('crash-agent', ?, 'crash-turn', 'main', 'task', '{}', 'crash-session', 'completed', 1, 1)`,
      )
      .run(source.id)
    const operations = new HandoffRepository(db)
    operations.create({
      operationID: 'fork-crash',
      sourceThreadID: source.id,
      direction: 'local-to-worktree',
      destination: { kind: 'local' },
      requestHash: 'fork-crash',
    })

    let reachedPiFork!: () => void
    let releasePiFork!: () => void
    const reached = new Promise<void>((resolve) => {
      reachedPiFork = resolve
    })
    const release = new Promise<void>((resolve) => {
      releasePiFork = resolve
    })
    let id = 0
    const interrupted = new ThreadForkRepository(db, () => `crash-fork-${++id}`, {
      fork: async () => {
        reachedPiFork()
        await release
        throw new Error('simulated process interruption')
      },
    })
    const pending = interrupted.fork(source.id, {
      operationID: 'fork-crash',
      targetThreadID: 'fork-crash-target',
      targetWorkspace: { cwd: 'C:\\managed\\target', roots: '[]', gitBranch: 'feature' },
    })
    await reached
    expect(
      db.sqlite
        .query("SELECT target_thread_id FROM thread_forks WHERE operation_id = 'fork-crash'")
        .get(),
    ).toEqual({ target_thread_id: 'fork-crash-target' })
    expect(
      new ThreadProjection(db).list({ archived: false }).map((thread) => thread.id),
    ).not.toContain('fork-crash-target')
    expect(
      new ThreadProjection(db).list({ archived: true }).map((thread) => thread.id),
    ).not.toContain('fork-crash-target')

    new ThreadForkRepository(db).rollback('fork-crash')
    expect(
      db.sqlite.query("SELECT id FROM threads WHERE id = 'fork-crash-target'").get(),
    ).toBeNull()
    releasePiFork()
    await expect(pending).rejects.toMatchObject({ code: 'HISTORY_UNSUPPORTED' })

    const retried = await new ThreadForkRepository(db, () => `retry-fork-${++id}`).fork(source.id, {
      operationID: 'fork-crash',
      targetThreadID: 'fork-crash-target',
      targetWorkspace: { cwd: 'C:\\managed\\target', roots: '[]', gitBranch: 'feature' },
    })
    expect(retried.targetThreadID).toBe('fork-crash-target')
    expect(
      db.sqlite.query("SELECT id FROM pi_sessions WHERE thread_id = 'fork-crash-target'").get(),
    ).not.toBeNull()
  })

  test('legacy hidden fork 即使缺少 marker 也不会进入 active 或 archived list', async () => {
    const db = await database()
    const hidden = db.createThread('legacy hidden')
    db.sqlite
      .query(
        "UPDATE threads SET archived_at = -1, create_operation_id = 'legacy-fork' WHERE id = ?",
      )
      .run(hidden.id)
    expect(
      new ThreadProjection(db).list({ archived: false }).map((thread) => thread.id),
    ).not.toContain(hidden.id)
    expect(
      new ThreadProjection(db).list({ archived: true }).map((thread) => thread.id),
    ).not.toContain(hidden.id)
  })

  test('同 operationId 并发 start 共享唯一 owner，完成后重放只返回现有状态', async () => {
    const db = await database()
    const source = db.createThread('source')
    const operations = new HandoffRepository(db)
    const context = {
      threadID: source.id,
      bindingID: 'worktree-binding',
      kind: 'worktree' as const,
      cwd: 'worktree',
      workspaceRootsJson: '[]',
      projectID: 'project',
      worktreeID: 'worktree-1',
    }
    const localContext = {
      threadID: source.id,
      bindingID: 'local-binding',
      kind: 'local' as const,
      cwd: 'local',
      workspaceRootsJson: '[]',
      projectID: 'project',
    }
    let releasePreflight!: () => void
    const preflightGate = new Promise<void>((resolve) => {
      releasePreflight = resolve
    })
    let preflights = 0
    let transfers = 0
    const workspaces: HandoffWorkspacePort = {
      source: async () => context,
      prepareDestination: async () => localContext,
      bindTarget: async () => undefined,
      recover: async () => ({ source: context, destination: localContext }),
      rollbackPreparation: async () => undefined,
      finalize: async () => undefined,
    }
    const lifecycle: HandoffLifecyclePort = {
      preflight: async () => {
        preflights += 1
        await preflightGate
      },
      stopSource: async () => undefined,
      closeTerminal: async () => undefined,
    }
    const plan = {
      direction: 'worktree-to-local' as const,
      sourceCwd: 'worktree',
      destinationCwd: 'local',
      sourceBranch: 'feature',
      sourceHead: 'source-head',
      destinationBranch: null,
      destinationHead: 'destination-head',
      fallbackBranch: null,
    }
    const git = {
      inspect: async () => plan,
      createJournal: () => ({
        sourceHead: plan.sourceHead,
        sourceBranch: plan.sourceBranch,
        destinationHead: plan.destinationHead,
        sourceStashMarker: 'source-marker',
      }),
      transfer: async (
        _plan: unknown,
        onStep: (
          step:
            'capture-source' | 'release-branch' | 'checkout-destination' | 'apply-source-changes',
          journal: object,
        ) => void,
        journal: object,
      ) => {
        transfers += 1
        expect(operations.journal('single-flight')).toMatchObject({
          sourceStashMarker: 'source-marker',
        })
        onStep('capture-source', journal)
        onStep('release-branch', journal)
        onStep('checkout-destination', journal)
        onStep('apply-source-changes', journal)
        return { journal, warnings: [] }
      },
      rollback: async () => true,
    } as unknown as GitHandoffCoordinator
    const service = new HandoffService(
      operations,
      new ThreadForkRepository(db),
      workspaces,
      lifecycle,
      git,
    )
    const input = {
      operationID: 'single-flight',
      sourceThreadID: source.id,
      destination: { kind: 'local' as const },
    }
    const first = service.start(input)
    const duplicate = service.start(input)
    expect(duplicate).toBe(first)
    expect(() => service.start({ ...input, sourceThreadID: 'different-source' })).toThrow(
      'operationId 已用于其他 Handoff 请求',
    )
    releasePreflight()
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
    expect(firstResult).toMatchObject({
      status: 'await-client-transfer',
      targetThreadId: expect.any(String),
    })
    expect(duplicateResult).toEqual(firstResult)
    expect({ preflights, transfers }).toEqual({ preflights: 1, transfers: 1 })
    expect(service.pending(source.id)).toEqual(firstResult)

    expect(await service.start(input)).toEqual(firstResult)
    expect({ preflights, transfers }).toEqual({ preflights: 1, transfers: 1 })
  })

  test('重启恢复只逆序回滚一次并将 running operation 终结', async () => {
    const db = await database()
    const source = db.createThread('source')
    const operations = new HandoffRepository(db)
    operations.create({
      operationID: 'recover-op',
      sourceThreadID: source.id,
      direction: 'local-to-worktree',
      destination: { kind: 'local' },
      requestHash: 'request',
    })
    operations.advance('recover-op', 'stop-source', {
      journal: { sourceHead: 'a', sourceBranch: 'feature', destinationHead: 'b' },
    })
    let gitRecoveries = 0
    let workspaceRollbacks = 0
    const context = {
      threadID: source.id,
      bindingID: 'binding',
      kind: 'local' as const,
      cwd: 'local',
      workspaceRootsJson: '[]',
      projectID: 'project',
    }
    const workspaces: HandoffWorkspacePort = {
      source: async () => context,
      prepareDestination: async () => ({ ...context, kind: 'worktree' as const, cwd: 'worktree' }),
      bindTarget: async () => undefined,
      recover: async () => ({
        source: context,
        destination: { ...context, kind: 'worktree' as const, cwd: 'worktree' },
      }),
      rollbackPreparation: async () => {
        workspaceRollbacks += 1
      },
      finalize: async () => undefined,
    }
    const lifecycle: HandoffLifecyclePort = {
      preflight: async () => undefined,
      stopSource: async () => undefined,
      closeTerminal: async () => undefined,
    }
    const git = {
      recover: async () => {
        gitRecoveries += 1
        return true
      },
    } as unknown as GitHandoffCoordinator
    const service = new HandoffService(
      operations,
      new ThreadForkRepository(db),
      workspaces,
      lifecycle,
      git,
    )
    expect(await service.recover('recover-op')).toMatchObject({
      status: 'failed',
      errorCode: 'HANDOFF_IN_PROGRESS',
    })
    expect(await service.recover('recover-op')).toMatchObject({ status: 'failed' })
    expect({ gitRecoveries, workspaceRollbacks }).toEqual({
      gitRecoveries: 1,
      workspaceRollbacks: 1,
    })
  })

  test('重启从 operation 恢复目标位置，不把缺失或错误 binding 的隐藏 target 当作默认 local', async () => {
    const db = await database()
    const source = db.createThread('source')
    const target = db.createThread('hidden target')
    const repository = new WorktreeRepository(db.sqlite)
    repository.insertWorktree({
      id: 'destination-worktree',
      projectId: 'project-1',
      repositoryRoot: 'C:\\repo',
      path: 'C:\\managed\\destination',
      status: 'ready',
      branchName: 'feature',
      baseCommit: 'a'.repeat(40),
      headCommit: 'a'.repeat(40),
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
    })
    const bindings = new TaskExecutionBindingService(
      repository,
      () => 1,
      () => 'target-binding',
    )
    bindings.bindLocal({ threadId: target.id, projectId: 'project-1', cwd: 'C:\\repo' })
    const operations = new HandoffRepository(db)
    operations.create({
      operationID: 'restart-destination',
      sourceThreadID: source.id,
      direction: 'local-to-worktree',
      destination: { kind: 'worktree', worktreeID: 'destination-worktree' },
      requestHash: 'request',
    })
    const runtime = (threadID: string) => ({
      kind: 'project' as const,
      projectID: 'project-1',
      workspaceRoot: 'C:\\repo',
      cwd: 'C:\\repo',
      runtimeWorkspaceRoots: [{ folderId: 'primary', path: 'C:\\repo', role: 'primary' as const }],
      instructionSources: [],
      outputDirectory: null,
      workspace: {} as never,
      executionBinding: {
        threadId: threadID,
        bindingId: threadID === source.id ? 'source-binding' : 'target-binding',
        kind: 'local' as const,
        projectId: 'project-1',
        cwd: 'C:\\repo',
        worktreeId: null,
        revision: 1,
        environmentRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    })
    const workspace = new BindingHandoffWorkspace(
      db,
      { resolve: async (threadID: string) => runtime(threadID) } as never,
      bindings,
      repository,
      operations,
      new EnvironmentDeltaStore(join(tmpdir(), 'unused-handoff-environment')),
    )
    const recovered = await workspace.recover({
      operationID: 'restart-destination',
      sourceThreadID: source.id,
      targetThreadID: target.id,
      direction: 'local-to-worktree',
    })
    expect(recovered.destination).toMatchObject({
      kind: 'worktree',
      worktreeID: 'destination-worktree',
      cwd: 'C:\\managed\\destination',
    })
  })

  test('BindingHandoffWorkspace 按目标位置选择环境 delta，并让 revision 与文件一致', async () => {
    const db = await database()
    const source = db.createThread('source')
    const target = db.createThread('target')
    const repository = new WorktreeRepository(db.sqlite)
    const allocated = ['copied-binding', 'failed-binding']
    const bindings = new TaskExecutionBindingService(
      repository,
      () => 1,
      () => allocated.shift()!,
    )
    const environmentRoot = await mkdtemp(join(tmpdir(), 'pidex-handoff-environment-'))
    roots.push(environmentRoot)
    const deltas = new EnvironmentDeltaStore(environmentRoot)
    await deltas.replace('source-binding', { set: { HANDOFF_ENV: 'copied' }, unset: ['OLD_ENV'] })
    const operations = new HandoffRepository(db)
    operations.create({
      operationID: 'copy-environment',
      sourceThreadID: source.id,
      direction: 'worktree-to-local',
      destination: { kind: 'local' },
      sourceBindingID: 'source-binding',
      requestHash: 'copy-environment',
    })
    const workspace = new BindingHandoffWorkspace(
      db,
      {
        resolve: async () => {
          throw new Error('not used')
        },
      } as never,
      bindings,
      repository,
      operations,
      deltas,
    )
    await workspace.bindTarget({
      operationID: 'copy-environment',
      source: {
        threadID: source.id,
        bindingID: 'source-binding',
        kind: 'worktree',
        cwd: 'C:\\managed\\source',
        workspaceRootsJson: '[]',
        projectID: 'project-1',
        worktreeID: 'source-worktree',
      },
      destination: {
        threadID: source.id,
        bindingID: 'prepared',
        kind: 'local',
        cwd: 'C:\\repo',
        workspaceRootsJson: '[]',
        projectID: 'project-1',
      },
      targetThreadID: target.id,
    })
    const binding = bindings.read(target.id)!
    expect(binding).toMatchObject({
      kind: 'local',
      bindingId: 'copied-binding',
      environmentRevision: 0,
    })
    expect(await deltas.read(binding.bindingId)).toEqual({ revision: 0, set: {}, unset: [] })
    expect(operations.targetBindingID('copy-environment')).toBe('copied-binding')
    await workspace.rollbackPreparation('copy-environment')
    expect(await deltas.read('copied-binding')).toEqual({ revision: 0, set: {}, unset: [] })

    operations.fail('copy-environment', 'HANDOFF_IN_PROGRESS')
    operations.create({
      operationID: 'failed-copy-environment',
      sourceThreadID: source.id,
      direction: 'worktree-to-local',
      destination: { kind: 'local' },
      sourceBindingID: 'source-binding',
      requestHash: 'failed-copy-environment',
    })
    await expect(
      workspace.bindTarget({
        operationID: 'failed-copy-environment',
        source: {
          threadID: source.id,
          bindingID: 'source-binding',
          kind: 'worktree',
          cwd: 'C:\\managed\\source',
          workspaceRootsJson: '[]',
          projectID: 'project-1',
          worktreeID: 'source-worktree',
        },
        destination: {
          threadID: source.id,
          bindingID: 'prepared',
          kind: 'local',
          cwd: 'C:\\repo',
          workspaceRootsJson: '[]',
          projectID: 'project-1',
        },
        targetThreadID: 'missing-target',
      }),
    ).rejects.toBeTruthy()
    expect(await deltas.read('failed-binding')).toEqual({ revision: 0, set: {}, unset: [] })
  })

  test('admission preflight 拒绝 queue，且 PTY 关闭只能由 typed handshake 确认', async () => {
    const db = await database()
    const source = db.createThread('source')
    db.sqlite
      .query(
        `INSERT INTO turns (id, thread_id, status, mode, model_ref, strategy, created_at, updated_at)
      VALUES ('queued-turn', ?, 'queued', 'chat', '{}', 'queue', 1, 1)`,
      )
      .run(source.id)
    let clock = 0
    let closeChecks = 0
    const lifecycle = new HandoffLifecycle(
      db,
      { stop: async () => 'interrupted' } as never,
      async () => {
        closeChecks += 1
        return false
      },
      {
        terminalCloseTimeoutMs: 2,
        terminalClosePollIntervalMs: 1,
        now: () => clock,
        wait: async (milliseconds) => {
          clock += milliseconds
        },
      },
    )
    await expect(lifecycle.preflight(source.id)).rejects.toMatchObject({ code: 'QUEUE_NOT_EMPTY' })
    db.sqlite.query("UPDATE turns SET status = 'completed' WHERE id = 'queued-turn'").run()
    await lifecycle.preflight(source.id)
    await expect(lifecycle.closeTerminal(source.id)).rejects.toMatchObject({
      code: 'SOURCE_ACTIVE',
      details: undefined,
    })
    expect(closeChecks).toBe(3)

    let successChecks = 0
    const eventuallyClosed = new HandoffLifecycle(
      db,
      { stop: async () => 'interrupted' } as never,
      async () => ++successChecks >= 3,
      {
        terminalCloseTimeoutMs: 2,
        terminalClosePollIntervalMs: 1,
        now: () => clock,
        wait: async (milliseconds) => {
          clock += milliseconds
        },
      },
    )
    await expect(eventuallyClosed.closeTerminal(source.id)).resolves.toBeUndefined()
    expect(successChecks).toBe(3)
  })
})

describe('Handoff Git preflight', () => {
  test('Local→Worktree 捕获 dirty/untracked、迁移 branch，并可无 hard reset 逆序恢复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-handoff-git-'))
    roots.push(root)
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    const run = async (cwd: string, args: string[]) => {
      const child = Bun.spawn(['git', ...args], {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (code !== 0) throw new Error(`git test setup failed: ${stderr}`)
      return stdout.trim()
    }
    await Bun.spawn(['git', 'init', '--initial-branch=main', source], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited
    await run(source, ['config', 'user.email', 'test@example.com'])
    await run(source, ['config', 'user.name', 'Test'])
    await writeFile(join(source, 'tracked.txt'), 'base\n', 'utf8')
    await run(source, ['add', 'tracked.txt'])
    await run(source, ['commit', '-m', 'base'])
    await run(source, ['checkout', '-b', 'feature'])
    await run(source, ['worktree', 'add', '--detach', destination, 'HEAD'])
    await writeFile(join(destination, 'destination.txt'), 'destination dirty\n', 'utf8')
    await writeFile(join(source, 'tracked.txt'), 'changed\n', 'utf8')
    await writeFile(join(source, 'untracked.txt'), 'new\n', 'utf8')

    const git = new GitHandoffCoordinator()
    const plan = await git.inspect('local-to-worktree', source, destination)
    const prepared = git.createJournal(plan)
    expect(prepared).toMatchObject({
      sourceHead: plan.sourceHead,
      sourceBranch: 'feature',
      destinationHead: plan.destinationHead,
      sourceStashMarker: expect.stringMatching(/^pidex-handoff-source-/),
    })
    // Simulate a process stopping after `stash push` but before its OID was
    // checkpointed. Recovery must rediscover it from the durable random marker.
    await run(source, [
      'stash',
      'push',
      '--include-untracked',
      '--message',
      prepared.sourceStashMarker!,
    ])
    expect(await run(source, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('')
    expect(await git.rollback(plan, prepared)).toBe(true)
    expect((await readFile(join(source, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'changed\n',
    )
    expect((await readFile(join(source, 'untracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'new\n',
    )
    expect(
      (await readFile(join(destination, 'destination.txt'), 'utf8')).replace(/\r\n/g, '\n'),
    ).toBe('destination dirty\n')

    const moved = await git.transfer(plan)
    expect(await run(source, ['branch', '--show-current'])).toBe('main')
    expect(await run(destination, ['branch', '--show-current'])).toBe('feature')
    expect((await readFile(join(destination, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'changed\n',
    )
    expect(
      (await readFile(join(destination, 'untracked.txt'), 'utf8')).replace(/\r\n/g, '\n'),
    ).toBe('new\n')
    expect(
      (await readFile(join(destination, 'destination.txt'), 'utf8')).replace(/\r\n/g, '\n'),
    ).toBe('destination dirty\n')

    expect(await git.rollback(plan, moved.journal)).toBe(true)
    expect(await run(source, ['branch', '--show-current'])).toBe('feature')
    expect((await readFile(join(source, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'changed\n',
    )
    expect((await readFile(join(source, 'untracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
      'new\n',
    )
    expect(
      (await readFile(join(destination, 'destination.txt'), 'utf8')).replace(/\r\n/g, '\n'),
    ).toBe('destination dirty\n')
    expect(await git.rollback(plan, moved.journal)).toBe(true)
  }, 30_000)

  test('worktree→local 检查命名分支 ref/head，而不要求 local 当前签出同一分支', async () => {
    const commands: string[][] = []
    const runner: HandoffGitRunner = {
      async run(cwd, args) {
        commands.push([cwd, ...args])
        const key = args.join(' ')
        if (key === 'rev-parse --show-toplevel') return { code: 0, stdout: `${cwd}\n`, stderr: '' }
        if (key === 'rev-parse --verify HEAD') return { code: 0, stdout: 'abc\n', stderr: '' }
        if (key === 'symbolic-ref --quiet --short HEAD')
          return { code: 0, stdout: cwd === 'source' ? 'feature\n' : 'main\n', stderr: '' }
        if (key === 'rev-parse --verify refs/heads/feature')
          return { code: 0, stdout: 'abc\n', stderr: '' }
        if (key === 'worktree list --porcelain')
          return {
            code: 0,
            stdout:
              'worktree source\nbranch refs/heads/feature\n\nworktree local\nbranch refs/heads/main\n',
            stderr: '',
          }
        if (key === 'status --porcelain=v1 --untracked-files=all')
          return { code: 0, stdout: '', stderr: '' }
        return { code: 1, stdout: '', stderr: 'sensitive path must not escape' }
      },
    }
    const plan = await new GitHandoffCoordinator(runner).inspect(
      'worktree-to-local',
      'source',
      'local',
    )
    expect(plan).toMatchObject({
      sourceBranch: 'feature',
      destinationBranch: 'main',
      sourceHead: 'abc',
    })
    expect(commands.some((command) => command.includes('--hard'))).toBe(false)
  })

  test('其他 worktree 占用分支时返回稳定安全错误', async () => {
    const runner: HandoffGitRunner = {
      async run(cwd, args) {
        const key = args.join(' ')
        if (key === 'rev-parse --show-toplevel') return { code: 0, stdout: `${cwd}\n`, stderr: '' }
        if (key === 'rev-parse --verify HEAD' || key === 'rev-parse --verify refs/heads/feature')
          return { code: 0, stdout: 'abc\n', stderr: '' }
        if (key === 'symbolic-ref --quiet --short HEAD')
          return { code: 0, stdout: 'feature\n', stderr: '' }
        if (key === 'worktree list --porcelain')
          return {
            code: 0,
            stdout:
              'worktree source\nbranch refs/heads/feature\n\nworktree elsewhere\nbranch refs/heads/feature\n',
            stderr: '',
          }
        return { code: 0, stdout: '', stderr: '' }
      },
    }
    await expect(
      new GitHandoffCoordinator(runner).inspect('worktree-to-local', 'source', 'local'),
    ).rejects.toMatchObject({
      code: 'BRANCH_IN_USE',
      message: '目标分支已在其他工作区中签出',
      details: undefined,
    } satisfies Partial<AgentError>)
  })
})
