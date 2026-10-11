import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { ThreadService } from '../src/session/ThreadService'
import { EnvironmentDeltaStore } from '../src/local-environment/EnvironmentDeltaStore'
import { HISTORY_SCHEMA, initializeSchema } from '../src/storage/database/SchemaInitializer'
import { TerminalContextService } from '../src/terminal/TerminalContextService'
import { ManagedWorktreeService } from '../src/worktree/ManagedWorktreeService'
import { TaskExecutionBindingService } from '../src/worktree/TaskExecutionBindingService'
import { WorktreeRepository } from '../src/worktree/WorktreeRepository'
import { WorktreeOperationOutputBuffer } from '../src/worktree/WorktreeOperationOutputBuffer'
import { ManagedProjectlessWorkspaceService } from '../src/workspace/ManagedProjectlessWorkspaceService'
import { ThreadWorkspaceResolver } from '../src/workspace/ThreadWorkspaceResolver'

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const git = async (cwd: string, args: readonly string[]) => {
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
  return { stdout: stdout.trim(), stderr: stderr.trim(), code }
}

const fixture = async (
  options: {
    settings?: () => { root?: string; fetchUpstream?: boolean }
    cleanup?: (input: {
      onOutput: (chunk: string) => void
    }) => Promise<{ warnings?: readonly string[] }>
  } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-managed-worktree-'))
  roots.push(root)
  const repositoryRoot = join(root, 'repository')
  const managedRoot = join(root, 'managed')
  const stateRoot = join(root, 'state')
  await Promise.all([mkdir(repositoryRoot), mkdir(managedRoot), mkdir(stateRoot)])
  expect((await git(repositoryRoot, ['init'])).code).toBe(0)
  await writeFile(
    join(repositoryRoot, '.gitignore'),
    'cache/\nlinks/\nAGENTS.override.md\n',
    'utf8',
  )
  await writeFile(
    join(repositoryRoot, '.worktreeinclude'),
    '/cache/*.env\n!/cache/skip.env\nlinks/**\n',
    'utf8',
  )
  await writeFile(join(repositoryRoot, 'tracked.txt'), 'base\n', 'utf8')
  expect((await git(repositoryRoot, ['add', '.'])).code).toBe(0)
  expect(
    (
      await git(repositoryRoot, [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'base',
      ])
    ).code,
  ).toBe(0)
  await writeFile(join(repositoryRoot, 'tracked.txt'), 'staged\n', 'utf8')
  expect((await git(repositoryRoot, ['add', 'tracked.txt'])).code).toBe(0)
  await writeFile(join(repositoryRoot, 'tracked.txt'), 'unstaged\n', 'utf8')
  await writeFile(join(repositoryRoot, 'draft.txt'), 'draft\n', 'utf8')
  await mkdir(join(repositoryRoot, 'cache'))
  await writeFile(join(repositoryRoot, 'cache', 'selected.env'), 'selected\n', 'utf8')
  await writeFile(join(repositoryRoot, 'cache', 'skip.env'), 'skip\n', 'utf8')
  await writeFile(join(repositoryRoot, 'AGENTS.override.md'), 'override\n', 'utf8')
  await mkdir(join(repositoryRoot, 'links'))
  let symlinkCreated = false
  try {
    await symlink(
      join(repositoryRoot, 'tracked.txt'),
      join(repositoryRoot, 'links', 'unsafe-link'),
      'file',
    )
    symlinkCreated = true
  } catch {
    /* Windows without developer mode cannot create symlinks. */
  }

  const db = new AgentDatabase({
    historyPath: join(root, 'history.sqlite'),
    profilePath: join(root, 'profile.sqlite'),
  })
  const worktrees = new WorktreeRepository(db.sqlite)
  let setupCalls = 0
  const service = await ManagedWorktreeService.open({
    repository: worktrees,
    managedRoot,
    stateRoot,
    ...(options.settings ? { settings: options.settings } : {}),
    resolveProjectRoot: (projectId) => (projectId === 'project-1' ? repositoryRoot : null),
    id: () => 'worktree-1',
    environment: {
      setup: async ({ onOutput }) => {
        setupCalls += 1
        onOutput('setup tail\n')
        return {
          status: setupCalls === 1 ? 'failed' : 'succeeded',
          environmentRevision: setupCalls,
        }
      },
      cleanup:
        options.cleanup ??
        (async ({ onOutput }) => {
          onOutput('cleanup tail\n')
          return {}
        }),
    },
  })
  return { root, repositoryRoot, managedRoot, stateRoot, db, worktrees, service, symlinkCreated }
}

describe('ManagedWorktreeService', () => {
  test('根目录偏好变化后，已有工作树仍从创建时的根删除与恢复', async () => {
    let customRoot = ''
    const { service, worktrees, root, repositoryRoot, db } = await fixture({
      settings: () => ({ root: customRoot }),
    })
    customRoot = join(root, 'first-root')
    const created = await service.create({
      projectId: 'project-1',
      operationId: 'custom-create',
      startingState: { type: 'working-tree' },
      snapshotMode: 'head',
    })
    expect(worktrees.ownedRoot(created.worktree.id)).toBe(customRoot)
    await service.continueWithoutSetup({
      worktreeId: created.worktree.id,
      operationId: 'custom-continue',
    })
    customRoot = join(root, 'second-root')
    await service.delete({ worktreeId: created.worktree.id, operationId: 'custom-delete' })
    const restored = await service.restore({
      worktreeId: created.worktree.id,
      operationId: 'custom-restore',
    })
    expect(service.settingsList()[0]!.path.startsWith(join(root, 'first-root'))).toBe(true)
    expect(restored.worktree.id).toBe(created.worktree.id)
    expect((await git(repositoryRoot, ['status', '--porcelain'])).code).toBe(0)
    db.close()
  })
  test('operation output 仅保留 64KiB 内存 tail 并在完成十分钟后过期', () => {
    let now = 1_000
    const output = new WorktreeOperationOutputBuffer(() => now)
    output.append('operation', 'x\n'.repeat(35_000))
    expect(output.read('operation', 0)).toMatchObject({
      cursor: 70_000,
      truncated: true,
      complete: false,
    })
    expect(Buffer.byteLength(output.read('operation', 0).data, 'utf8')).toBe(65_536)
    output.append('unicode', '你\n'.repeat(30_000))
    const unicode = output.read('unicode', 0)
    expect(Buffer.byteLength(unicode.data, 'utf8')).toBeLessThanOrEqual(65_536)
    expect(unicode.data.includes('�')).toBe(false)
    output.append('sanitized', '\u001b[31mauth_token=super-secret-value\u001b[0m\n')
    const sanitized = output.read('sanitized', 0).data
    expect(sanitized).not.toContain('\u001b')
    expect(sanitized).not.toContain('super-secret-value')
    expect(sanitized).toContain('auth_token=<redacted>')
    output.append('split-secret', 'sk-abcdefghijkl')
    expect(output.read('split-secret', 0).data).toBe('')
    output.append('split-secret', 'mnopqrstuv\n')
    const splitSecret = output.read('split-secret', 0).data
    expect(splitSecret).not.toContain('sk-abcdefghijklmnopqrstuv')
    expect(splitSecret).toContain('<redacted>')
    output.append('split-secret-on-complete', 'auth_token=super-')
    output.append('split-secret-on-complete', 'secret-value')
    output.complete('split-secret-on-complete')
    const completedSecret = output.read('split-secret-on-complete', 0).data
    expect(completedSecret).not.toContain('super-secret-value')
    expect(completedSecret).toContain('auth_token=<redacted>')
    output.append('oversized-line', 'x'.repeat(70_000))
    expect(output.read('oversized-line', 0)).toMatchObject({
      cursor: 70_000,
      data: '',
      truncated: true,
    })
    output.append('oversized-line', '\nsafe\n')
    expect(output.read('oversized-line', 70_000)).toMatchObject({
      cursor: 70_006,
      data: 'safe\n',
      truncated: true,
    })
    output.complete('operation')
    now += 10 * 60 * 1000
    expect(output.read('operation', 70_000)).toEqual({
      cursor: 70_000,
      data: '',
      truncated: false,
      complete: true,
    })
  })

  test('history 24 逐代迁移到当前版本并只增加可忽略的独立表', () => {
    const sqlite = new Database(':memory:')
    const newObjects =
      /(?:managed_worktrees|thread_execution_bindings|worktree_operations|thread_handoff_operations|thread_forks|thread_message_fork_operations|thread_message_forks|turn_pi_boundaries|resume_checkpoint_leases|taskboard_|task_context_|automations|automation_runs|scheduled_tasks|schedule_plan_proposals)/
    sqlite.exec(HISTORY_SCHEMA.filter((statement) => !newObjects.test(statement)).join(';\n'))
    sqlite.exec('PRAGMA user_version = 24')
    initializeSchema(sqlite, 'history')
    expect(sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    const tables = new Set(
      (
        sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map(({ name }) => name),
    )
    for (const table of [
      'managed_worktrees',
      'thread_execution_bindings',
      'worktree_operations',
      'thread_handoff_operations',
      'thread_forks',
    ]) {
      expect(tables.has(table)).toBe(true)
    }
    for (const table of [
      'thread_message_fork_operations',
      'thread_message_forks',
      'turn_pi_boundaries',
    ]) {
      expect(tables.has(table)).toBe(true)
    }
    expect(tables.has('resume_checkpoint_leases')).toBe(true)
    sqlite.close()
  })

  test('working-tree 分层复制、setup 门禁、binding/terminal context 与 delete/restore 保持一致', async () => {
    const value = await fixture()
    try {
      const created = await value.service.create({
        projectId: 'project-1',
        startingState: { type: 'working-tree' },
        operationId: 'create-1',
      })
      expect(created.worktree).toMatchObject({
        status: 'ready-with-setup-error',
        setupStatus: 'failed',
      })
      const internal = value.worktrees.readWorktree(created.worktree.id)!
      expect(
        (await readFile(join(internal.path, 'tracked.txt'), 'utf8')).replaceAll('\r\n', '\n'),
      ).toBe('unstaged\n')
      expect((await git(internal.path, ['diff', '--cached', '--name-only'])).stdout).toContain(
        'tracked.txt',
      )
      expect((await git(internal.path, ['diff', '--name-only'])).stdout).toContain('tracked.txt')
      expect(await Bun.file(join(internal.path, 'draft.txt')).exists()).toBe(true)
      expect(await Bun.file(join(internal.path, 'cache', 'selected.env')).exists()).toBe(true)
      expect(await Bun.file(join(internal.path, 'cache', 'skip.env')).exists()).toBe(false)
      expect(await Bun.file(join(internal.path, 'AGENTS.override.md')).exists()).toBe(true)
      if (value.symlinkCreated)
        expect(await Bun.file(join(internal.path, 'links', 'unsafe-link')).exists()).toBe(false)

      expect(value.service.operationStatus('create-1', 0)).toMatchObject({
        operation: { status: 'completed' },
        output: { data: 'setup tail\n', complete: true },
      })
      expect(
        await value.service.create({
          projectId: 'project-1',
          startingState: { type: 'working-tree' },
          operationId: 'create-1',
        }),
      ).toEqual(created)

      const continued = value.service.continueWithoutSetup({
        worktreeId: internal.id,
        operationId: 'continue-1',
      })
      expect(continued.worktree).toMatchObject({
        continuedWithoutSetup: true,
        setupStatus: 'skipped',
      })

      const project = value.db.createProject({
        id: 'project-1',
        rootPath: value.repositoryRoot,
        name: 'Project',
      })
      const thread = value.db.createThread('worktree task', project.id)
      const bindings = new TaskExecutionBindingService(
        value.worktrees,
        () => 100,
        () => 'binding-1',
      )
      const binding = bindings.bindWorktree({
        threadId: thread.id,
        projectId: project.id,
        worktreeId: internal.id,
        environmentRevision: 7,
      })
      expect(binding).toMatchObject({
        kind: 'worktree',
        cwd: internal.path,
        environmentRevision: 7,
      })
      const resolver = new ThreadWorkspaceResolver(
        value.db,
        new ManagedProjectlessWorkspaceService(join(value.root, 'documents')),
        bindings,
      )
      const firstContext = await new TerminalContextService(resolver).resolve(thread.id)
      expect(firstContext).toMatchObject({
        bindingId: 'binding-1',
        target: { kind: 'worktree', cwd: internal.path },
      })
      bindings.updateEnvironmentRevision(thread.id, 8)
      const secondContext = await new TerminalContextService(resolver).resolve(thread.id)
      expect(secondContext.contextVersion).not.toBe(firstContext.contextVersion)

      await writeFile(join(internal.path, 'draft.txt'), 'restored draft\n', 'utf8')
      value.db.sqlite
        .query('UPDATE threads SET archived_at = ? WHERE id = ?')
        .run(Date.now(), thread.id)
      const deleted = await value.service.delete({
        worktreeId: internal.id,
        operationId: 'delete-1',
      })
      expect(deleted.worktree.status).toBe('cleaned')
      expect(await Bun.file(internal.path).exists()).toBe(false)
      expect(value.service.operationStatus('delete-1', 0).output).toMatchObject({
        data: 'cleanup tail\n',
        complete: true,
      })

      const restored = await value.service.restore({
        worktreeId: internal.id,
        operationId: 'restore-1',
      })
      expect(restored.worktree.status).toBe('ready')
      const restoredInternal = value.worktrees.readWorktree(internal.id)!
      expect(
        (await readFile(join(restoredInternal.path, 'draft.txt'), 'utf8')).replaceAll('\r\n', '\n'),
      ).toBe('restored draft\n')
      expect(
        (await git(restoredInternal.path, ['diff', '--cached', '--name-only'])).stdout,
      ).toContain('tracked.txt')
      expect((await git(restoredInternal.path, ['diff', '--name-only'])).stdout).toContain(
        'tracked.txt',
      )
      expect(await Bun.file(join(restoredInternal.path, 'cache', 'selected.env')).exists()).toBe(
        true,
      )
    } finally {
      value.db.close()
    }
  }, 60_000)

  test('同一 worktree 的不同 operationId 不能并发 delete/restore', async () => {
    let releaseCleanup!: () => void
    let cleanupStarted!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve
    })
    const value = await fixture({
      cleanup: async ({ onOutput }) => {
        cleanupStarted()
        onOutput('cleanup pending\n')
        await cleanupGate
        return {}
      },
    })
    try {
      const created = await value.service.create({
        projectId: 'project-1',
        startingState: { type: 'working-tree' },
        operationId: 'create-exclusive',
      })
      value.service.continueWithoutSetup({
        worktreeId: created.worktree.id,
        operationId: 'continue-exclusive',
      })

      const firstDelete = value.service.delete({
        worktreeId: created.worktree.id,
        operationId: 'delete-exclusive-1',
      })
      await started
      await expect(
        value.service.delete({
          worktreeId: created.worktree.id,
          operationId: 'delete-exclusive-2',
        }),
      ).rejects.toThrow('另一个 worktree 操作仍在进行')
      expect(value.service.operationStatus('delete-exclusive-2').operation).toMatchObject({
        status: 'failed',
        errorCode: 'WORKTREE_OPERATION_CONFLICT',
      })
      releaseCleanup()
      await expect(firstDelete).resolves.toMatchObject({ worktree: { status: 'cleaned' } })

      const firstRestore = value.service.restore({
        worktreeId: created.worktree.id,
        operationId: 'restore-exclusive-1',
      })
      await expect(
        value.service.restore({
          worktreeId: created.worktree.id,
          operationId: 'restore-exclusive-2',
        }),
      ).rejects.toThrow('另一个 worktree 操作仍在进行')
      await expect(firstRestore).resolves.toMatchObject({ worktree: { status: 'ready' } })
      expect(
        value.worktrees.listWorktrees('project-1').filter(({ id }) => id === created.worktree.id),
      ).toHaveLength(1)
    } finally {
      releaseCleanup?.()
      value.db.close()
    }
  }, 60_000)

  test('restore 在 unstaged 冲突时不先应用 staged patch 或恢复文件', async () => {
    const value = await fixture()
    try {
      const created = await value.service.create({
        projectId: 'project-1',
        startingState: { type: 'working-tree' },
        operationId: 'create-preflight',
      })
      value.service.continueWithoutSetup({
        worktreeId: created.worktree.id,
        operationId: 'continue-preflight',
      })
      const deleted = await value.service.delete({
        worktreeId: created.worktree.id,
        operationId: 'delete-preflight',
      })
      expect(deleted.worktree.status).toBe('cleaned')
      const snapshotPath = value.worktrees.readWorktree(created.worktree.id)!.restoreSnapshotPath!
      await writeFile(
        join(snapshotPath, 'unstaged.patch'),
        [
          'diff --git a/tracked.txt b/tracked.txt',
          '--- a/tracked.txt',
          '+++ b/tracked.txt',
          '@@ -1 +1 @@',
          '-content-that-does-not-exist',
          '+conflict',
          '',
        ].join('\n'),
        'utf8',
      )

      const restored = await value.service.restore({
        worktreeId: created.worktree.id,
        operationId: 'restore-preflight',
      })
      expect(restored).toMatchObject({
        worktree: { status: 'restore-conflict' },
        operation: { status: 'failed', errorCode: 'WORKTREE_APPLY_CONFLICT' },
      })
      const conflictPath = value.worktrees.readWorktree(created.worktree.id)!.path
      expect((await git(conflictPath, ['diff', '--cached', '--name-only'])).stdout).toBe('')
      expect((await git(conflictPath, ['diff', '--name-only'])).stdout).toBe('')
      expect(await Bun.file(join(conflictPath, 'draft.txt')).exists()).toBe(false)
    } finally {
      value.db.close()
    }
  }, 60_000)

  test('旧任务默认 local，schema 25 表存在且未绑定的新 worktree 不进入自动清理候选', async () => {
    const value = await fixture()
    try {
      const project = value.db.createProject({
        id: 'project-1',
        rootPath: value.repositoryRoot,
        name: 'Project',
      })
      const thread = value.db.createThread('local task', project.id)
      const bindings = new TaskExecutionBindingService(value.worktrees)
      const descriptor = value.db.threadWorkspace(thread.id)!
      expect(bindings.resolve(thread.id, descriptor)).toMatchObject({
        kind: 'local',
        worktreeId: null,
        environmentRevision: 0,
      })
      const tables = new Set(
        (
          value.db.sqlite
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as Array<{ name: string }>
        ).map(({ name }) => name),
      )
      for (const table of [
        'managed_worktrees',
        'thread_execution_bindings',
        'worktree_operations',
        'thread_handoff_operations',
        'thread_forks',
      ]) {
        expect(tables.has(table)).toBe(true)
      }
      const created = await value.service.create({
        projectId: project.id,
        startingState: { type: 'branch', branchName: 'HEAD' },
        operationId: 'create-unbound',
      })
      expect(value.worktrees.cleanupCandidates(project.id, 10)).toEqual([])
      const template = value.worktrees.readWorktree(created.worktree.id)!
      expect(template.boundOnce).toBe(false)
      const insertCandidate = (id: string, patch: Partial<typeof template> = {}) =>
        value.worktrees.insertWorktree({
          ...template,
          id,
          path: join(value.managedRoot, id),
          status: 'ready',
          setupStatus: 'succeeded',
          continuedWithoutSetup: false,
          boundOnce: true,
          ...patch,
        })
      insertCandidate('permanent', { permanent: true })
      insertCandidate('pinned', { pinned: true })
      insertCandidate('active')
      insertCandidate('pending')
      insertCandidate('eligible')
      const activeThread = value.db.createThread('active', project.id)
      bindings.bindWorktree({
        threadId: activeThread.id,
        projectId: project.id,
        worktreeId: 'active',
      })
      const archivedThread = value.db.createThread('archived', project.id)
      bindings.bindWorktree({
        threadId: archivedThread.id,
        projectId: project.id,
        worktreeId: 'eligible',
      })
      value.db.sqlite
        .query('UPDATE threads SET archived_at = ? WHERE id = ?')
        .run(Date.now(), archivedThread.id)
      value.worktrees.insertOperation({
        operationId: 'pending-op',
        worktreeId: 'pending',
        projectId: project.id,
        kind: 'delete',
        requestHash: 'hash',
        step: 'queued',
        status: 'pending',
        revision: 1,
        errorCode: null,
        warnings: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
      })
      expect(value.worktrees.cleanupCandidates(project.id, 10).map(({ id }) => id)).toEqual([
        'eligible',
      ])
    } finally {
      value.db.close()
    }
  }, 30_000)

  test('thread/create 在发布任务前原子绑定 execution，并复制匹配 revision 的环境 delta', async () => {
    const value = await fixture()
    try {
      const project = value.db.createProject({
        id: 'project-1',
        rootPath: value.repositoryRoot,
        name: 'Project',
      })
      const bindings = new TaskExecutionBindingService(
        value.worktrees,
        () => 100,
        (() => {
          let id = 0
          return () => `binding-${++id}`
        })(),
      )
      const resolver = new ThreadWorkspaceResolver(
        value.db,
        new ManagedProjectlessWorkspaceService(join(value.root, 'documents')),
        bindings,
      )
      const questions = { setResumeHandler: () => undefined }
      const subagents = { setParentResumeHandler: () => undefined }
      const threads = new ThreadService(
        value.db,
        null as never,
        null as never,
        null as never,
        questions as never,
        null as never,
        subagents as never,
        null as never,
        { dataRoot: value.root, userHome: value.root },
        null as never,
        null as never,
        resolver,
      )
      const environmentDeltas = new EnvironmentDeltaStore(value.stateRoot)
      const targetPath = join(value.managedRoot, 'rpc-worktree')
      await mkdir(targetPath)
      const base = value.worktrees.readWorktree(
        (
          await value.service.create({
            projectId: project.id,
            startingState: { type: 'branch', branchName: 'HEAD' },
            operationId: 'seed-worktree',
          })
        ).worktree.id,
      )!
      value.worktrees.insertWorktree({
        ...base,
        id: 'rpc-worktree',
        path: targetPath,
        status: 'ready',
        setupStatus: 'succeeded',
        environmentRevision: 1,
        continuedWithoutSetup: false,
      })
      await environmentDeltas.replace('rpc-worktree', { set: { TEST_ENV: 'copied' }, unset: [] })
      expect(() => bindings.validateWorktree(project.id, 'missing')).toThrow()
      expect(value.db.threadForCreateOperation('invalid-create')).toBeNull()
      await expect(
        threads.create({
          workspace: { kind: 'project', projectID: project.id, execution: { kind: 'local' } },
          operationID: 'atomic-failure',
          bindExecution: () => {
            throw new Error('binding failed')
          },
        }),
      ).rejects.toThrow('binding failed')
      expect(value.db.threadForCreateOperation('atomic-failure')).toBeNull()

      const preparedWorktree = bindings.validateWorktree(project.id, 'rpc-worktree')
      const worktreeBindingId = bindings.allocateBindingId()
      const copiedEnvironment = await environmentDeltas.copy(
        preparedWorktree.id,
        worktreeBindingId,
        preparedWorktree.environmentRevision,
      )
      const worktreeCreated = await threads.create({
        workspace: {
          kind: 'project',
          projectID: project.id,
          execution: { kind: 'worktree', worktreeId: 'rpc-worktree' },
        },
        operationID: 'worktree-create',
        bindExecution: (threadID) =>
          bindings.bindWorktree({
            threadId: threadID,
            projectId: project.id,
            worktreeId: preparedWorktree.id,
            bindingId: worktreeBindingId,
            environmentRevision: copiedEnvironment.revision,
          }),
      })
      const worktreeBinding = bindings.read(worktreeCreated.id)!
      expect(worktreeBinding).toMatchObject({
        kind: 'worktree',
        worktreeId: 'rpc-worktree',
        environmentRevision: 1,
      })
      expect(await environmentDeltas.read(worktreeBinding.bindingId)).toEqual({
        revision: 1,
        set: { TEST_ENV: 'copied' },
        unset: [],
      })

      const localBindingId = bindings.allocateBindingId()
      const localCreated = await threads.create({
        workspace: { kind: 'project', projectID: project.id, execution: { kind: 'local' } },
        operationID: 'local-create',
        bindExecution: (threadID) => {
          const descriptor = value.db.threadWorkspace(threadID)
          if (!descriptor || descriptor.kind !== 'project')
            throw new Error('missing project workspace')
          bindings.bindLocal({
            threadId: threadID,
            projectId: project.id,
            cwd: descriptor.cwd,
            bindingId: localBindingId,
            environmentRevision: 0,
          })
        },
      })
      expect(bindings.read(localCreated.id)).toMatchObject({
        kind: 'local',
        environmentRevision: 0,
      })

      const legacyCreated = await threads.create({
        workspace: { kind: 'project', projectID: project.id },
        operationID: 'legacy-create',
      })
      expect(bindings.read(legacyCreated.id)).toBeNull()
      expect((await resolver.resolve(legacyCreated.id)).executionBinding.kind).toBe('local')
    } finally {
      value.db.close()
    }
  }, 60_000)
})
