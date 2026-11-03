import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { SubagentRepository } from '../src/subagent/SubagentRepository'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []

afterEach(async () => {
  await removeFixturePaths(paths.splice(0))
})

const model = Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') })
const permission = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

function seededDatabase(root: string): AgentDatabase {
  return new AgentDatabase({
    historyPath: join(root, 'history.sqlite'),
    profilePath: join(root, 'profile.sqlite'),
  })
}

describe('subagent role schema', () => {
  test('schema 71 前向迁移补 nullable role 列，保留旧任务与未知对象', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-subagent-role-schema-'))
    paths.push(root)

    const seeded = seededDatabase(root)
    // 模拟 71 版库：去掉 role 列，并写入一个未知对象。
    seeded.sqlite.exec(`
      ALTER TABLE subagent_tasks DROP COLUMN role;
      CREATE TABLE future_schema_71_extension (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_schema_71_extension VALUES ('kept', 'unknown');
      PRAGMA user_version = 71;
    `)
    seeded.close()

    const migrated = seededDatabase(root)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    const columns = (
      migrated.sqlite.query('PRAGMA table_info(subagent_tasks)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(columns).toContain('role')
    expect(
      migrated.sqlite
        .query('SELECT COUNT(*) AS count FROM subagent_tasks WHERE role IS NOT NULL')
        .get(),
    ).toEqual({ count: 0 })
    expect(
      migrated.sqlite.query("SELECT value FROM future_schema_71_extension WHERE id = 'kept'").get(),
    ).toEqual({ value: 'unknown' })
    migrated.close()
  })

  test('未知 role 值原样留在库中，读取时按缺失回退且不重写', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-subagent-role-unknown-'))
    paths.push(root)

    const db = seededDatabase(root)
    const thread = db.createThread()
    const rootTurn = db.createTurn(thread.id, {
      content: 'root',
      model,
      permissionConfig: permission,
      strategy: 'queue',
      taskMode: 'chat',
    })
    const created = new SubagentRepository(db).create({
      parentThreadID: thread.id,
      parentTurnID: rootTurn.turnID,
      parentAgentID: rootTurn.agentID,
      displayName: 'Agent 1',
      profile: 'worker',
      task: '实现接口',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: 'C:\\workspace',
    })
    db.sqlite
      .query('UPDATE subagent_tasks SET role = ? WHERE id = ?')
      .run('future-role', created.task.id)

    expect(new SubagentRepository(db).task(created.task.id)?.role).toBeUndefined()
    // 未知值不被清洗或覆盖。
    expect(
      db.sqlite.query('SELECT role FROM subagent_tasks WHERE id = ?').get(created.task.id),
    ).toEqual({ role: 'future-role' })
    db.close()
  })
})
