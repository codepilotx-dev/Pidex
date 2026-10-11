import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { SubagentRepository } from '../src/subagent/SubagentRepository'
import { SubagentWorkspaceCoordinator } from '../src/subagent/SubagentWorkspaceCoordinator'
import { WorkspaceIsolationService } from '../src/subagent/WorkspaceIsolationService'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const model = Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') })
const permission = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

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

const setup = async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pidex-subagent-workspace-'))
  paths.push(parent)
  const root = join(parent, 'repository')
  const data = join(parent, 'data')
  const databasePath = join(tmpdir(), `pidex-subagent-workspace-${crypto.randomUUID()}.sqlite`)
  paths.push(databasePath, `${databasePath}-wal`, `${databasePath}-shm`)
  await mkdir(root)
  await mkdir(data)
  expect((await git(root, ['init'])).code).toBe(0)
  await writeFile(join(root, 'tracked.txt'), 'base\n', 'utf8')
  expect((await git(root, ['add', '.'])).code).toBe(0)
  expect(
    (
      await git(root, [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'initial',
      ])
    ).code,
  ).toBe(0)

  const db = new AgentDatabase(databasePath)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: 'root',
    model,
    permissionConfig: permission,
    strategy: 'queue',
    taskMode: 'chat',
  })
  const repository = new SubagentRepository(db)
  const created = repository.create({
    parentThreadID: thread.id,
    parentTurnID: turn.turnID,
    parentAgentID: turn.agentID,
    displayName: 'Legacy Worker',
    profile: 'worker',
    task: '修改文件',
    model,
    permissionCeiling: permission,
    workspaceMode: 'worktree',
    workspaceRoot: root,
  })
  return { root, data, db, created }
}

const prepareLegacyWorktree = async (
  root: string,
  data: string,
  db: AgentDatabase,
  taskID: string,
) => {
  const key = createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0, 16)
  const service = await WorkspaceIsolationService.open(root, join(data, key))
  const baseline = await service.createWorktree(taskID)
  db.sqlite.query('UPDATE subagent_tasks SET workspace_state = ? WHERE id = ?').run(
    JSON.stringify({
      mode: 'worktree',
      state: 'ready',
      rootPath: baseline.workspacePath,
      baselineRef: baseline.ref,
      isolation: baseline,
    }),
    taskID,
  )
  return baseline
}

describe('SubagentWorkspaceCoordinator', () => {
  test('legacy worktree 完成时无冲突自动应用并清理', async () => {
    const { root, data, db, created } = await setup()
    const coordinator = new SubagentWorkspaceCoordinator(db, data)
    const prepared = await prepareLegacyWorktree(root, data, db, created.task.id)
    await writeFile(join(prepared.workspacePath, 'tracked.txt'), 'child\n', 'utf8')

    expect(await coordinator.recoverLegacyWorktrees()).toMatchObject([
      {
        taskID: created.task.id,
        result: { status: 'applied' },
      },
    ])
    expect((await readFile(join(root, 'tracked.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
      'child\n',
    )
    expect(
      db.sqlite
        .query(
          "SELECT workspace_mode AS mode, json_extract(workspace_state, '$.state') AS state FROM subagent_tasks WHERE id = ?",
        )
        .get(created.task.id),
    ).toEqual({ mode: 'shared', state: 'applied' })
    expect(
      await stat(prepared.workspacePath).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    db.close()
  }, 30_000)

  test('尚未创建 isolation 的 legacy task 直接迁移为 shared', async () => {
    const { root, data, db, created } = await setup()
    const coordinator = new SubagentWorkspaceCoordinator(db, data)

    expect(await coordinator.recoverLegacyWorktrees()).toEqual([
      {
        taskID: created.task.id,
        result: { status: 'migrated-to-shared' },
      },
    ])
    expect(
      db.sqlite
        .query(
          "SELECT workspace_mode AS mode, json_extract(workspace_state, '$.state') AS state FROM subagent_tasks WHERE id = ?",
        )
        .get(created.task.id),
    ).toEqual({ mode: 'shared', state: 'ready' })
    expect(await coordinator.prepare(created.task.id, root, 'shared')).toMatchObject({
      rootPath: root,
      baselineRef: expect.any(String),
    })
    db.close()
  }, 30_000)

  test('legacy worktree 与父工作区冲突时零写入并保留人工处理状态', async () => {
    const { root, data, db, created } = await setup()
    const coordinator = new SubagentWorkspaceCoordinator(db, data)
    const prepared = await prepareLegacyWorktree(root, data, db, created.task.id)
    await writeFile(join(prepared.workspacePath, 'tracked.txt'), 'child\n', 'utf8')
    await writeFile(join(root, 'tracked.txt'), 'parent\n', 'utf8')

    expect(await coordinator.finalize(created.task.id)).toMatchObject({
      status: 'conflict',
      workspaceUnchanged: true,
    })
    expect((await readFile(join(root, 'tracked.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
      'parent\n',
    )
    expect(
      db.sqlite
        .query(
          "SELECT json_extract(workspace_state, '$.state') AS state FROM subagent_tasks WHERE id = ?",
        )
        .get(created.task.id),
    ).toEqual({ state: 'conflict' })
    expect(
      await stat(prepared.workspacePath).then(
        () => true,
        () => false,
      ),
    ).toBe(true)
    db.close()
  }, 30_000)
})
